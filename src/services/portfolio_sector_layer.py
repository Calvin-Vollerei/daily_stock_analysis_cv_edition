# -*- coding: utf-8 -*-
"""Optional client for the external portfolio sector layer.

The sector layer is a local sidecar HTTP service (``PORTFOLIO_SECTOR_LAYER_URL``,
disabled by default). It rewrites the industry block of the portfolio risk report
with fund-quarter (季报) look-through weights, which the built-in data sources
cannot derive for ETFs and off-exchange funds: those codes have no exchange board
membership, so the in-process path can only report ``UNCLASSIFIED`` for them.

The dependency is strictly optional and never load-bearing:

* empty URL -> no request at all;
* any transport error, non-200 answer or malformed payload -> ``None`` and the
  caller falls back to the built-in computation;
* the outbound request carries ``sector_layer=local`` so the sidecar forwards a
  bypass flag back to the built-in route instead of calling itself in a loop.
"""

from __future__ import annotations

import json
import logging
import math
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

RISK_PATH = "/api/v1/portfolio/risk"
LOOKTHROUGH_PATH = "/api/v1/portfolio/lookthrough"
#: Query parameter that tells the risk route to skip the sidecar hop.
BYPASS_PARAM = "sector_layer"
BYPASS_LOCAL = "local"
BYPASS_PROXY = "proxy"

#: Default location of the sidecar's look-through snapshot, relative to the app
#: working directory (the packaged layout ships it as ``sector-layer/lookthrough.json``).
DEFAULT_LOOKTHROUGH_PATH = "sector-layer/lookthrough.json"

#: Blocks the Web client needs before it accepts a risk payload.
REQUIRED_RESPONSE_KEYS = (
    "as_of",
    "cost_method",
    "currency",
    "thresholds",
    "concentration",
    "sector_concentration",
    "drawdown",
    "stop_loss",
)


def build_risk_url(
    base_url: str,
    *,
    account_id: Optional[int] = None,
    as_of: Optional[date] = None,
    cost_method: str = "fifo",
    include_realtime: bool = True,
) -> str:
    """Build the sidecar risk URL, or ``""`` when the layer is not configured."""
    base = (base_url or "").strip().rstrip("/")
    if not base:
        return ""
    params: Dict[str, str] = {BYPASS_PARAM: BYPASS_LOCAL}
    if account_id is not None:
        params["account_id"] = str(account_id)
    if as_of is not None:
        params["as_of"] = as_of.isoformat()
    params["cost_method"] = cost_method
    params["include_realtime"] = "true" if include_realtime else "false"
    return f"{base}{RISK_PATH}?{urllib.parse.urlencode(params)}"


def _is_risk_payload(payload: Any) -> bool:
    if not isinstance(payload, dict):
        return False
    if any(key not in payload for key in REQUIRED_RESPONSE_KEYS):
        return False
    if not isinstance(payload.get("concentration"), dict):
        return False
    sector = payload.get("sector_concentration")
    if not isinstance(sector, dict):
        return False
    if not isinstance(sector.get("top_sectors"), list):
        return False
    return True


def fetch_sector_layer_risk(
    config: Any,
    *,
    account_id: Optional[int] = None,
    as_of: Optional[date] = None,
    cost_method: str = "fifo",
    include_realtime: bool = True,
) -> Optional[Dict[str, Any]]:
    """Return the sidecar risk payload, or ``None`` to use the built-in computation."""
    url = build_risk_url(
        getattr(config, "portfolio_sector_layer_url", "") or "",
        account_id=account_id,
        as_of=as_of,
        cost_method=cost_method,
        include_realtime=include_realtime,
    )
    if not url:
        return None

    timeout = getattr(config, "portfolio_sector_layer_timeout_s", 12.0)
    try:
        timeout = max(1.0, float(timeout))
    except (TypeError, ValueError):
        timeout = 12.0

    request = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            status = getattr(response, "status", 200)
            if status != 200:
                logger.info("[PortfolioSectorLayer] Sidecar returned HTTP %s, using built-in risk", status)
                return None
            payload = json.loads(response.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as exc:
        logger.info("[PortfolioSectorLayer] Sidecar HTTP error %s, using built-in risk", exc.code)
        return None
    except Exception as exc:
        logger.info("[PortfolioSectorLayer] Sidecar unavailable (%s), using built-in risk", exc)
        return None

    if not _is_risk_payload(payload):
        logger.warning("[PortfolioSectorLayer] Sidecar payload rejected, using built-in risk")
        return None
    return payload


# ---------------------------------------------------------------------------
# Look-through (持仓穿透) snapshot
#
# The sidecar owns the ETF/fund holdings look-through computation and publishes
# the same payload it serves on ``LOOKTHROUGH_PATH``. When the sidecar is not
# configured or not answering we fall back to the snapshot file it writes next
# to its own code, so the Web card keeps working with a slightly stale snapshot.
# ---------------------------------------------------------------------------


def build_lookthrough_url(base_url: str, *, account_id: Optional[int] = None) -> str:
    """Build the sidecar look-through URL, or ``""`` when the layer is not configured."""
    base = (base_url or "").strip().rstrip("/")
    if not base:
        return ""
    params: Dict[str, str] = {}
    if account_id is not None:
        params["account_id"] = str(account_id)
    query = f"?{urllib.parse.urlencode(params)}" if params else ""
    return f"{base}{LOOKTHROUGH_PATH}{query}"


def _is_finite_number(value: Any) -> bool:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    try:
        return math.isfinite(float(value))
    except (TypeError, ValueError):
        return False


def _is_lookthrough_payload(payload: Any) -> bool:
    """Structural check of the snapshot the look-through card can render."""
    if not isinstance(payload, dict):
        return False
    stock_count = payload.get("stock_count")
    if isinstance(stock_count, bool) or not isinstance(stock_count, int):
        return False
    if not _is_finite_number(payload.get("penetrated_weight_pct")):
        return False
    if not _is_finite_number(payload.get("total_market_value")):
        return False
    if not isinstance(payload.get("coverage"), dict):
        return False
    stocks = payload.get("stocks")
    if not isinstance(stocks, list):
        return False
    return True


def fetch_sector_layer_lookthrough(
    config: Any,
    *,
    account_id: Optional[int] = None,
) -> Optional[Dict[str, Any]]:
    """Return the sidecar look-through payload, or ``None`` to use the local snapshot file."""
    url = build_lookthrough_url(
        getattr(config, "portfolio_sector_layer_url", "") or "",
        account_id=account_id,
    )
    if not url:
        return None

    timeout = getattr(config, "portfolio_sector_layer_timeout_s", 12.0)
    try:
        timeout = max(1.0, float(timeout))
    except (TypeError, ValueError):
        timeout = 12.0

    request = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            status = getattr(response, "status", 200)
            if status != 200:
                logger.info(
                    "[PortfolioSectorLayer] Look-through sidecar returned HTTP %s, using local snapshot",
                    status,
                )
                return None
            payload = json.loads(response.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as exc:
        logger.info(
            "[PortfolioSectorLayer] Look-through sidecar HTTP error %s, using local snapshot",
            exc.code,
        )
        return None
    except Exception as exc:
        logger.info(
            "[PortfolioSectorLayer] Look-through sidecar unavailable (%s), using local snapshot",
            exc,
        )
        return None

    if not _is_lookthrough_payload(payload):
        logger.warning(
            "[PortfolioSectorLayer] Look-through sidecar payload rejected, using local snapshot"
        )
        return None
    return payload


def _lookthrough_file_candidates(config: Any) -> List[Path]:
    """Candidate snapshot paths, most specific first.

    An explicit ``PORTFOLIO_LOOKTHROUGH_PATH`` wins outright; otherwise the
    installed layout (``<app dir>/sector-layer/lookthrough.json``) is tried
    relative to the working directory, then next to the frozen executable and up
    to four of its parents, then the repository root, so a different launch
    directory does not hide the file.
    """
    configured = (getattr(config, "portfolio_lookthrough_path", "") or "").strip()
    candidates: List[Path] = []
    if configured:
        candidates.append(Path(configured).expanduser())
    else:
        candidates.append(Path(DEFAULT_LOOKTHROUGH_PATH))
        if getattr(sys, "frozen", False):
            # The packaged backend runs with cwd = resources/backend/stock_analysis;
            # the snapshot may also live a few levels up (the installed app root).
            exe_dir = Path(sys.executable).resolve().parent
            candidates.append(exe_dir / DEFAULT_LOOKTHROUGH_PATH)
            for parent in list(exe_dir.parents)[:4]:
                candidates.append(parent / DEFAULT_LOOKTHROUGH_PATH)
        candidates.append(Path(__file__).resolve().parents[2] / DEFAULT_LOOKTHROUGH_PATH)
    return candidates


def load_local_lookthrough(config: Any) -> Optional[Dict[str, Any]]:
    """Read the local snapshot file, or ``None`` when absent/unreadable/invalid."""
    for path in _lookthrough_file_candidates(config):
        try:
            if not path.is_file():
                continue
            with path.open("r", encoding="utf-8") as handle:
                payload = json.load(handle)
        except Exception as exc:
            logger.info(
                "[PortfolioSectorLayer] Look-through snapshot unreadable (%s): %s", path, exc
            )
            continue
        if not _is_lookthrough_payload(payload):
            logger.warning(
                "[PortfolioSectorLayer] Look-through snapshot rejected: %s", path
            )
            continue
        logger.info("[PortfolioSectorLayer] Look-through snapshot served from %s", path)
        return payload
    return None
