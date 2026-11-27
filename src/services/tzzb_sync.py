# -*- coding: utf-8 -*-
"""TZZB (Tonghuashun investment ledger) portfolio sync settings and reader.

The Tonghuashun investment ledger (同花顺投资账本 / "账本精灵", TZZB) is the
personal ledger behind the accounts DSA cannot quote on its own: bank wealth
products, ICBC gold, and OTC funds. DSA therefore treats TZZB as an optional
portfolio data source with two independent access methods:

* ``TZZB_SYNC_COMMAND`` - a bridge command that reads the ledger and writes the
  portfolio tables. This is the only path that persists holdings.
* ``TZZB_MCP_ENDPOINT`` + ``TZZB_MCP_AUTH_FILE`` - a read-only JSON-RPC probe.
  DSA itself asks the ledger which accounts exist, how fresh they are, and
  whether the configured ``TZZB_SYNC_ACCOUNTS`` scope can be matched. The probe
  never writes holdings and never writes the credential file (no token refresh:
  the bridge command owns that).

Both are opt-in and default to off. Everything here is startup best effort: the
caller runs it in a daemon thread, every failure is logged and swallowed, and an
empty configuration keeps the previous behaviour byte for byte.
"""

from __future__ import annotations

import json
import logging
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

logger = logging.getLogger(__name__)

ACCOUNTS_ENV = "TZZB_SYNC_ACCOUNTS"
ENDPOINT_ENV = "TZZB_MCP_ENDPOINT"
AUTH_FILE_ENV = "TZZB_MCP_AUTH_FILE"

DEFAULT_MIN_INTERVAL_SECONDS = 6 * 3600.0
DEFAULT_TIMEOUT_SECONDS = 900.0
DEFAULT_PROBE_TIMEOUT_SECONDS = 10.0
PROBE_MAX_RESPONSE_BYTES = 512 * 1024
ACCOUNT_SELECTION_TOOL = "promptAccountSelection"
ACCOUNT_SELECTION_ARGUMENTS = {"scope": "all"}
# A token inside this window is treated as expired: the probe only reads, and a
# near-empty lifetime makes the request race the expiry.
TOKEN_EXPIRY_SKEW_SECONDS = 60.0


@dataclass(frozen=True)
class TzzbSettings:
    """Resolved TZZB sync settings (never contains secrets)."""

    enabled: bool = False
    command: str = ""
    mcp_endpoint: str = ""
    mcp_auth_file: str = ""
    accounts: Tuple[str, ...] = ()
    min_interval_seconds: float = DEFAULT_MIN_INTERVAL_SECONDS
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS

    @property
    def has_command(self) -> bool:
        return bool(self.command)

    @property
    def has_mcp(self) -> bool:
        return bool(self.mcp_endpoint)

    @property
    def active(self) -> bool:
        """True when the switch is on and at least one access method is set."""
        return self.enabled and (self.has_command or self.has_mcp)

    def describe(self) -> str:
        """Short, secret-free description for logs."""
        methods = []
        if self.has_command:
            methods.append("command")
        if self.has_mcp:
            methods.append("mcp")
        scope = ",".join(self.accounts) if self.accounts else "all"
        return (
            f"enabled={self.enabled} methods={'+'.join(methods) or 'none'} "
            f"accounts={scope} interval={self.min_interval_seconds:.0f}s "
            f"timeout={self.timeout_seconds:.0f}s"
        )


def _as_float(value: Any, default: float) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return default
    return parsed if parsed >= 0 else default


def _as_text(value: Any) -> str:
    return str(value).strip() if value is not None else ""


def split_accounts(raw: Any) -> Tuple[str, ...]:
    """Split a comma/space separated account scope into unique entries."""
    if raw is None:
        return ()
    if isinstance(raw, (list, tuple, set)):
        parts: Iterable[Any] = raw
    else:
        parts = str(raw).replace(";", ",").replace("\n", ",").split(",")
    accounts: List[str] = []
    for part in parts:
        item = _as_text(part)
        if item and item not in accounts:
            accounts.append(item)
    return tuple(accounts)


def load_settings(config: Any = None) -> TzzbSettings:
    """Build settings from the live Config (env / Web Settings data_source page)."""
    if config is None:
        try:
            from src.config import get_config

            config = get_config()
        except Exception as exc:  # noqa: BLE001 - settings must never break startup
            logger.warning("[tzzb] settings unavailable (%s); ledger sync disabled", exc)
            return TzzbSettings()

    return TzzbSettings(
        enabled=bool(getattr(config, "tzzb_sync_enabled", False)),
        command=_as_text(getattr(config, "tzzb_sync_command", "")),
        mcp_endpoint=_as_text(getattr(config, "tzzb_mcp_endpoint", "")),
        mcp_auth_file=_as_text(getattr(config, "tzzb_mcp_auth_file", "")),
        accounts=split_accounts(getattr(config, "tzzb_sync_accounts", "")),
        min_interval_seconds=_as_float(
            getattr(config, "tzzb_sync_min_interval_seconds", DEFAULT_MIN_INTERVAL_SECONDS),
            DEFAULT_MIN_INTERVAL_SECONDS,
        ),
        timeout_seconds=_as_float(
            getattr(config, "tzzb_sync_timeout_seconds", DEFAULT_TIMEOUT_SECONDS),
            DEFAULT_TIMEOUT_SECONDS,
        ),
    )


def build_child_env(settings: TzzbSettings) -> Dict[str, str]:
    """Environment handed to the bridge command so it honours these settings.

    The command stays the single writer; DSA only forwards what the user
    configured, so a bridge script can read the account scope, endpoint and
    credential path without duplicating them in its own hard-coded constants.
    """
    env: Dict[str, str] = {}
    if settings.accounts:
        env[ACCOUNTS_ENV] = ",".join(settings.accounts)
    if settings.mcp_endpoint:
        env[ENDPOINT_ENV] = settings.mcp_endpoint
    if settings.mcp_auth_file:
        env[AUTH_FILE_ENV] = settings.mcp_auth_file
    return env


def summarize_accounts(payload: Any, scope: Iterable[str] = ()) -> Dict[str, Any]:
    """Summarize a ``promptAccountSelection`` payload without leaking names.

    The ledger answers with one array per account type; every entry carries
    ``id``/``name`` plus an optional ``lastSyncTime``. Groups themselves stay
    opaque so a new account type never breaks the probe.
    """
    accounts: List[Dict[str, str]] = []
    if isinstance(payload, dict):
        groups = payload.values()
    elif isinstance(payload, list):
        groups = [payload]
    else:
        groups = []

    seen_ids = set()
    for group in groups:
        if not isinstance(group, list):
            continue
        for entry in group:
            if not isinstance(entry, dict):
                continue
            account_id = _as_text(entry.get("id") or entry.get("accountId") or entry.get("account_id"))
            name = _as_text(entry.get("name") or entry.get("accountName") or entry.get("account_name"))
            if not account_id and not name:
                continue
            marker = account_id or name
            if marker in seen_ids:
                continue
            seen_ids.add(marker)
            accounts.append(
                {
                    "id": account_id,
                    "name": name,
                    "last_sync": _as_text(entry.get("lastSyncTime") or entry.get("last_sync")),
                }
            )

    wanted = [_as_text(item) for item in scope if _as_text(item)]
    matched: List[str] = []
    unknown: List[str] = []
    for item in wanted:
        needle = item.casefold()
        hit = any(
            needle == account["id"].casefold()
            or needle == account["name"].casefold()
            or needle in account["name"].casefold()
            for account in accounts
        )
        (matched if hit else unknown).append(item)

    freshest = max((account["last_sync"] for account in accounts if account["last_sync"]), default="")
    return {
        "account_count": len(accounts),
        "accounts": accounts,
        "scope": wanted,
        "scope_matched": matched,
        "scope_unknown": unknown,
        "latest_sync": freshest,
    }


def read_access_token(auth_file: str, *, now: Optional[float] = None) -> Optional[str]:
    """Read the ledger access token from a JSON credential file.

    DSA never refreshes or rewrites this file: an expired token is reported and
    the probe is skipped, because the bridge command owns the OAuth refresh.
    """
    if not auth_file:
        return None
    path = Path(auth_file).expanduser()
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        logger.warning("[tzzb] credential file not found: %s", path)
        return None
    except (OSError, ValueError) as exc:
        logger.warning("[tzzb] credential file unreadable (%s): %s", path, exc)
        return None

    if not isinstance(raw, dict):
        logger.warning("[tzzb] credential file is not a JSON object: %s", path)
        return None

    token = _as_text(raw.get("access_token") or raw.get("accessToken"))
    if not token:
        logger.warning("[tzzb] credential file has no access token: %s", path)
        return None

    expires_at_ms = raw.get("expires_at_ms") or raw.get("expires_at")
    try:
        expires_at = float(expires_at_ms) / 1000.0 if expires_at_ms else 0.0
    except (TypeError, ValueError):
        expires_at = 0.0
    if expires_at > 0:
        current = time.time() if now is None else now
        if current >= expires_at - TOKEN_EXPIRY_SKEW_SECONDS:
            logger.warning(
                "[tzzb] ledger credential expired at %s; skipping read-only probe "
                "(DSA never refreshes the token, the sync command does)",
                time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(expires_at)),
            )
            return None
    return token


def _decode_mcp_body(raw: bytes) -> str:
    text = raw.decode("utf-8", "replace").strip()
    if text.startswith(("event:", "data:")):
        for line in text.splitlines():
            stripped = line.strip()
            if stripped.startswith("data:"):
                return stripped[5:].strip()
    return text


def call_mcp(
    endpoint: str,
    token: str,
    tool: str,
    arguments: Dict[str, Any],
    *,
    timeout_seconds: float = DEFAULT_PROBE_TIMEOUT_SECONDS,
) -> Optional[Any]:
    """Call one MCP tool over JSON-RPC. Returns parsed payload or None."""
    body = json.dumps(
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": tool, "arguments": arguments},
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        endpoint,
        data=body,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "Authorization": "Bearer " + token,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
            raw = response.read(PROBE_MAX_RESPONSE_BYTES + 1)
    except urllib.error.HTTPError as exc:
        logger.warning("[tzzb] ledger endpoint returned HTTP %s", exc.code)
        return None
    except (urllib.error.URLError, OSError, ValueError) as exc:
        logger.warning("[tzzb] ledger endpoint unreachable: %s", exc)
        return None

    if len(raw) > PROBE_MAX_RESPONSE_BYTES:
        logger.warning("[tzzb] ledger response too large; probe skipped")
        return None

    try:
        envelope = json.loads(_decode_mcp_body(raw))
    except ValueError:
        logger.warning("[tzzb] ledger response is not JSON; probe skipped")
        return None

    if isinstance(envelope, dict) and envelope.get("error"):
        logger.warning("[tzzb] ledger returned error: %s", str(envelope["error"])[:200])
        return None

    content = (envelope.get("result") or {}).get("content") if isinstance(envelope, dict) else None
    if not isinstance(content, list) or not content:
        logger.warning("[tzzb] ledger returned no content; probe skipped")
        return None

    text = content[0].get("text") if isinstance(content[0], dict) else None
    if not isinstance(text, str) or not text.strip():
        logger.warning("[tzzb] ledger returned no text payload; probe skipped")
        return None
    try:
        return json.loads(text)
    except ValueError:
        logger.warning("[tzzb] ledger payload is not JSON; probe skipped")
        return None


def probe_accounts(
    settings: TzzbSettings, *, timeout_seconds: float = DEFAULT_PROBE_TIMEOUT_SECONDS
) -> Optional[Dict[str, Any]]:
    """Read-only account probe against the ledger MCP endpoint."""
    if not settings.has_mcp:
        return None
    token = read_access_token(settings.mcp_auth_file)
    if not token:
        return None
    payload = call_mcp(
        settings.mcp_endpoint,
        token,
        ACCOUNT_SELECTION_TOOL,
        dict(ACCOUNT_SELECTION_ARGUMENTS),
        timeout_seconds=timeout_seconds,
    )
    if payload is None:
        return None
    return summarize_accounts(payload, settings.accounts)


def run_preflight(settings: TzzbSettings) -> Optional[Dict[str, Any]]:
    """Run the optional ledger read and log a secret-free summary.

    Returns the summary (None when skipped or failed). Never raises: the caller
    is a startup daemon thread and an unreachable ledger must stay invisible to
    the analysis flow.
    """
    if not settings.has_mcp:
        return None
    try:
        summary = probe_accounts(settings)
    except Exception as exc:  # noqa: BLE001 - startup hook must stay best effort
        logger.warning("[tzzb] ledger probe failed: %s", exc)
        return None
    if summary is None:
        return None

    logger.info(
        "[tzzb] ledger read ok: accounts=%d latest_sync=%s scope=%s",
        summary["account_count"],
        summary["latest_sync"] or "unknown",
        ",".join(summary["scope"]) or "all",
    )
    if summary["scope_unknown"]:
        logger.warning(
            "[tzzb] account scope not found in ledger (ignored): %s",
            ", ".join(summary["scope_unknown"]),
        )
    return summary
