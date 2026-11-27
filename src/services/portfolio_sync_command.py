# -*- coding: utf-8 -*-
"""Optional account-sync command that runs once when the app opens.

Bank wealth products, ICBC gold and OTC fund NAVs have no realtime quote
source: they are refreshed by the user's own sync scripts. The desktop app used
to start them from an external launcher, which is gone. This module restores the
trigger inside the backend, driven entirely by configuration:

* ``PORTFOLIO_SYNC_COMMAND``  - shell command to run (empty disables the hook),
* ``PORTFOLIO_SYNC_MIN_INTERVAL_SECONDS`` - dedupe window (default 6h),
* ``PORTFOLIO_SYNC_TIMEOUT_SECONDS`` - hard timeout (default 15min),
* ``PORTFOLIO_SYNC_START_DELAY_SECONDS`` - delay after startup (default 3s).

The command runs in a daemon thread, its output is logged, and failures never
block the API. A marker file next to the database records the last run so that
opening the app repeatedly does not start the (slow) bank scraping every time.
"""

from __future__ import annotations

import logging
import os
import subprocess
import threading
import time
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

COMMAND_ENV = "PORTFOLIO_SYNC_COMMAND"
INTERVAL_ENV = "PORTFOLIO_SYNC_MIN_INTERVAL_SECONDS"
TIMEOUT_ENV = "PORTFOLIO_SYNC_TIMEOUT_SECONDS"
DELAY_ENV = "PORTFOLIO_SYNC_START_DELAY_SECONDS"
MARKER_NAME = ".portfolio-sync-last-run"

DEFAULT_INTERVAL_SECONDS = 6 * 3600.0
DEFAULT_TIMEOUT_SECONDS = 900.0
DEFAULT_START_DELAY_SECONDS = 3.0
CREATE_NO_WINDOW = 0x08000000

_schedule_lock = threading.Lock()
_scheduled = False
_worker: Optional[threading.Thread] = None


def _env_float(name: str, default: float) -> float:
    raw = (os.getenv(name) or "").strip()
    if not raw:
        return default
    try:
        value = float(raw)
    except ValueError:
        logger.warning("Invalid %s=%r; using default %s", name, raw, default)
        return default
    return value if value >= 0 else default


def _database_dir() -> Optional[Path]:
    try:
        from src.config import get_config

        db_path = Path(get_config().database_path)
    except Exception as exc:  # noqa: BLE001 - marker is best effort
        logger.warning("Cannot resolve database path for portfolio sync marker: %s", exc)
        return None
    try:
        return db_path.expanduser().resolve().parent
    except OSError:
        return db_path.expanduser().parent


def _marker_path() -> Optional[Path]:
    db_dir = _database_dir()
    return None if db_dir is None else db_dir / MARKER_NAME


def _last_run_at() -> float:
    marker = _marker_path()
    if marker is None or not marker.exists():
        return 0.0
    try:
        return float(marker.read_text(encoding="utf-8").strip() or "0")
    except (OSError, ValueError):
        return 0.0


def _write_marker(value: float) -> None:
    marker = _marker_path()
    if marker is None:
        return
    try:
        marker.parent.mkdir(parents=True, exist_ok=True)
        marker.write_text(str(value), encoding="utf-8")
    except OSError as exc:
        logger.warning("Cannot write portfolio sync marker %s: %s", marker, exc)


def _child_env() -> dict:
    env = dict(os.environ)
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"
    try:
        from src.config import get_config

        env["DSA_DB_PATH"] = str(Path(get_config().database_path).expanduser().resolve())
    except Exception as exc:  # noqa: BLE001 - scripts fall back to their own default
        logger.warning("Cannot inject DSA_DB_PATH for portfolio sync: %s", exc)
    return env


def _run_command(command: str, timeout_seconds: float) -> None:
    started = time.time()
    logger.info("[portfolio sync] command started: %s", command)
    try:
        completed = subprocess.run(  # noqa: S602 - operator-configured command
            command,
            shell=True,
            capture_output=True,
            timeout=timeout_seconds,
            env=_child_env(),
            creationflags=CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
    except subprocess.TimeoutExpired:
        logger.warning(
            "[portfolio sync] command timed out after %.0fs: %s", timeout_seconds, command
        )
        return
    except Exception as exc:  # noqa: BLE001 - startup hook must stay best effort
        logger.warning("[portfolio sync] command failed to start: %s", exc)
        return

    elapsed = time.time() - started
    stdout = (completed.stdout or b"").decode("utf-8", "replace")
    stderr = (completed.stderr or b"").decode("utf-8", "replace")
    tail = "\n".join((stdout + stderr).splitlines()[-20:])
    if completed.returncode == 0:
        logger.info("[portfolio sync] command finished rc=0 in %.1fs", elapsed)
    else:
        logger.warning(
            "[portfolio sync] command finished rc=%s in %.1fs", completed.returncode, elapsed
        )
    if tail:
        logger.info("[portfolio sync] output tail:\n%s", tail)


def _run_later(command: str, delay_seconds: float, timeout_seconds: float) -> None:
    try:
        if delay_seconds > 0:
            time.sleep(delay_seconds)
        _run_command(command, timeout_seconds)
    finally:
        _write_marker(time.time())


def schedule_portfolio_sync() -> bool:
    """Start the optional sync command once per interval. Returns True if started."""
    global _scheduled, _worker

    command = (os.getenv(COMMAND_ENV) or "").strip()
    if not command:
        logger.debug("[portfolio sync] disabled (no %s)", COMMAND_ENV)
        return False

    interval = _env_float(INTERVAL_ENV, DEFAULT_INTERVAL_SECONDS)
    timeout_seconds = _env_float(TIMEOUT_ENV, DEFAULT_TIMEOUT_SECONDS)
    delay_seconds = _env_float(DELAY_ENV, DEFAULT_START_DELAY_SECONDS)

    with _schedule_lock:
        if _worker is not None and _worker.is_alive():
            logger.info("[portfolio sync] previous run still in progress; skip")
            return False
        if _scheduled:
            elapsed = time.time() - _last_run_at()
            logger.info(
                "[portfolio sync] skip: last run %.0fs ago, interval=%.0fs", elapsed, interval
            )
            return False
        if interval > 0:
            elapsed = time.time() - _last_run_at()
            if elapsed < interval:
                logger.info(
                    "[portfolio sync] skip: last run %.0fs ago, interval=%.0fs", elapsed, interval
                )
                return False
        # Mark the schedule before spawning so a crash cannot storm the command.
        _write_marker(time.time())
        _scheduled = True
        worker = threading.Thread(
            target=_run_later,
            args=(command, delay_seconds, timeout_seconds),
            name="portfolio-sync-command",
            daemon=True,
        )
        _worker = worker

    worker.start()
    logger.info(
        "[portfolio sync] scheduled in %.1fs (timeout=%.0fs): %s",
        delay_seconds,
        timeout_seconds,
        command,
    )
    return True
