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
import urllib.error
import urllib.parse
import urllib.request
from datetime import date
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

RISK_PATH = "/api/v1/portfolio/risk"
#: Query parameter that tells the risk route to skip the sidecar hop.
BYPASS_PARAM = "sector_layer"
BYPASS_LOCAL = "local"
BYPASS_PROXY = "proxy"

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
