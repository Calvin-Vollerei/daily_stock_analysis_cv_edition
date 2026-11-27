# -*- coding: utf-8 -*-
"""Portfolio risk service for concentration, drawdown and stop-loss proximity."""

from __future__ import annotations

import logging
import time
from concurrent.futures import ThreadPoolExecutor, wait
from datetime import date, timedelta
from threading import Lock
from typing import Any, Dict, List, Optional, Tuple

from src.config import Config, get_config
from src.repositories.portfolio_repo import PortfolioRepository
from src.services.decision_signal_service import DecisionSignalService
from src.services.decision_signal_summary import summarize_decision_signal
from src.services.portfolio_service import PortfolioService

logger = logging.getLogger(__name__)

DEFENSIVE_DECISION_SIGNAL_ACTIONS = ("sell", "reduce", "alert")


class PortfolioRiskService:
    """Compute portfolio risk blocks on top of replayed snapshot data."""

    # Board membership rarely changes, but each lookup goes through the provider
    # rate limiter (efinance sleeps 1.5-3s per call) and the risk endpoint builds
    # a new service per request, so non-empty results are shared per process.
    _BELONG_BOARDS_CACHE_TTL_SECONDS = 24 * 60 * 60
    _belong_boards_cache_lock = Lock()
    _belong_boards_cache: Dict[str, Tuple[float, List[Dict[str, Any]]]] = {}

    # Empty or failed board lookups get their own short-lived negative cache.
    # ETFs and off-exchange funds have no exchange board at all, so without this
    # every single risk request re-paid ~3.6s per such holding and the browser
    # request timed out before the risk block could render.
    _BELONG_BOARDS_FAILURE_TTL_SECONDS = 5 * 60
    _belong_boards_failure_cache: Dict[str, float] = {}
    _belong_boards_failure_lock = Lock()

    # Hard wall-clock budget for the network part of the sector block. The risk
    # endpoint must stay well below the Web client request timeout; anything that
    # does not resolve in time is reported as unclassified instead of blocking.
    _SECTOR_LOOKUP_BUDGET_SECONDS = 4.0
    _SECTOR_LOOKUP_WORKERS = 8

    def __init__(
        self,
        *,
        repo: Optional[PortfolioRepository] = None,
        portfolio_service: Optional[PortfolioService] = None,
        decision_signal_service: Optional[DecisionSignalService] = None,
        config: Optional[Config] = None,
    ):
        self.repo = repo or PortfolioRepository()
        self.portfolio_service = portfolio_service or PortfolioService(repo=self.repo)
        self.decision_signal_service = decision_signal_service or DecisionSignalService(portfolio_repo=self.repo)
        self.config = config or get_config()
        self._data_manager = None
        self._data_manager_init_error = ""

    def get_risk_report(
        self,
        *,
        account_id: Optional[int] = None,
        as_of: Optional[date] = None,
        cost_method: str = "fifo",
        include_realtime: bool = True,
    ) -> Dict[str, Any]:
        as_of_date = as_of or date.today()
        snapshot = self.portfolio_service.get_portfolio_snapshot(
            account_id=account_id,
            as_of=as_of_date,
            cost_method=cost_method,
            include_realtime=include_realtime,
        )

        thresholds = {
            "concentration_alert_pct": float(getattr(self.config, "portfolio_risk_concentration_alert_pct", 35.0)),
            "drawdown_alert_pct": float(getattr(self.config, "portfolio_risk_drawdown_alert_pct", 15.0)),
            "stop_loss_alert_pct": float(getattr(self.config, "portfolio_risk_stop_loss_alert_pct", 10.0)),
            "stop_loss_near_ratio": float(getattr(self.config, "portfolio_risk_stop_loss_near_ratio", 0.8)),
            "lookback_days": int(getattr(self.config, "portfolio_risk_lookback_days", 180)),
        }

        concentration = self._build_concentration(
            snapshot,
            thresholds["concentration_alert_pct"],
            as_of_date=as_of_date,
        )
        sector_concentration = self._build_sector_concentration(
            snapshot,
            thresholds["concentration_alert_pct"],
            as_of_date=as_of_date,
        )
        self._ensure_drawdown_snapshot_window(
            account_id=account_id,
            as_of_date=as_of_date,
            cost_method=cost_method,
            lookback_days=thresholds["lookback_days"],
            include_realtime=include_realtime,
        )
        drawdown = self._build_drawdown(
            account_id=account_id,
            as_of_date=as_of_date,
            cost_method=cost_method,
            threshold_pct=thresholds["drawdown_alert_pct"],
            lookback_days=thresholds["lookback_days"],
        )
        stop_loss = self._build_stop_loss(snapshot, thresholds)
        decision_signal_risk = self._build_decision_signal_risk(snapshot)

        return {
            "as_of": as_of_date.isoformat(),
            "account_id": account_id,
            "cost_method": cost_method,
            "currency": snapshot["currency"],
            "thresholds": thresholds,
            "concentration": concentration,
            "sector_concentration": sector_concentration,
            "drawdown": drawdown,
            "stop_loss": stop_loss,
            "decision_signal_risk": decision_signal_risk,
        }

    def _build_decision_signal_risk(
        self,
        snapshot: Dict[str, Any],
    ) -> Dict[str, Any]:
        try:
            held_positions = self._held_position_identities(snapshot)
            if not held_positions:
                return self._empty_decision_signal_risk(available=True)
            stock_identities = sorted({
                (position["market"], position["signal_stock_code"])
                for position in held_positions
            })

            defensive_actions = set(DEFENSIVE_DECISION_SIGNAL_ACTIONS)
            latest_by_identity: Dict[Tuple[str, str], Dict[str, Any]] = {}
            page = 1
            while True:
                response = self.decision_signal_service.list_signals(
                    stock_identities=stock_identities,
                    status="active",
                    page=page,
                    page_size=100,
                )
                items = response.get("items", []) if isinstance(response, dict) else []
                for item in items:
                    if str(item.get("action") or "") not in defensive_actions:
                        continue
                    key = (
                        str(item.get("market") or "").strip().lower(),
                        str(item.get("stock_code") or "").strip().upper(),
                    )
                    if key[0] and key[1] and key not in latest_by_identity:
                        latest_by_identity[key] = item
                total = int(response.get("total", 0) or 0) if isinstance(response, dict) else 0
                if page * 100 >= total or not items:
                    break
                page += 1

            risk_items: List[Dict[str, Any]] = []
            action_counts = {action: 0 for action in DEFENSIVE_DECISION_SIGNAL_ACTIONS}
            seen: set[Tuple[Optional[int], str, str, int]] = set()
            for position in held_positions:
                signal = latest_by_identity.get((position["market"], position["signal_stock_code"]))
                summary = summarize_decision_signal(signal)
                if not summary:
                    continue
                action = str(summary.get("action") or "")
                if action not in action_counts:
                    continue
                signal_id = int(summary.get("id") or 0)
                dedupe_key = (position["account_id"], position["market"], position["signal_stock_code"], signal_id)
                if dedupe_key in seen:
                    continue
                seen.add(dedupe_key)
                action_counts[action] += 1
                risk_items.append({
                    "account_id": position["account_id"],
                    "symbol": position["symbol"],
                    "market": position["market"],
                    "signal": summary,
                })

            return {
                "available": True,
                "total": len(risk_items),
                "actions": action_counts,
                "items": risk_items,
            }
        except Exception:
            logger.exception("[PortfolioRiskService] Decision signal risk unavailable")
            return self._empty_decision_signal_risk(available=False)

    @staticmethod
    def _empty_decision_signal_risk(*, available: bool) -> Dict[str, Any]:
        return {
            "available": available,
            "total": 0,
            "actions": {action: 0 for action in DEFENSIVE_DECISION_SIGNAL_ACTIONS},
            "items": [],
        }

    @staticmethod
    def _held_position_identities(snapshot: Dict[str, Any]) -> List[Dict[str, Any]]:
        positions: List[Dict[str, Any]] = []
        for account in snapshot.get("accounts", []) or []:
            account_id = account.get("account_id")
            for pos in account.get("positions", []) or []:
                symbol = str(pos.get("symbol") or "").strip().upper()
                market = str(pos.get("market") or "").strip().lower()
                if not symbol or market not in {"cn", "hk", "us"}:
                    continue
                signal_stock_code = DecisionSignalService.normalize_stock_code_for_signal(symbol, market=market)
                positions.append({
                    "account_id": account_id,
                    "symbol": symbol,
                    "market": market,
                    "signal_stock_code": signal_stock_code,
                })
        return positions

    def _ensure_drawdown_snapshot_window(
        self,
        *,
        account_id: Optional[int],
        as_of_date: date,
        cost_method: str,
        lookback_days: int,
        include_realtime: bool,
    ) -> None:
        if lookback_days <= 0:
            return

        start_date = self._resolve_backfill_start_date(
            account_id=account_id,
            as_of_date=as_of_date,
            lookback_days=lookback_days,
        )
        if start_date > as_of_date:
            return

        existing_rows = self.repo.list_daily_snapshots_for_risk(
            as_of=as_of_date,
            cost_method=cost_method,
            account_id=account_id,
            lookback_days=lookback_days,
        )
        if account_id is not None:
            existing_dates = {row.snapshot_date for row in existing_rows if int(row.account_id) == int(account_id)}
            current_date = start_date
            while current_date <= as_of_date:
                if current_date not in existing_dates:
                    self.portfolio_service.get_portfolio_snapshot(
                        account_id=account_id,
                        as_of=current_date,
                        cost_method=cost_method,
                        include_realtime=include_realtime,
                    )
                    existing_dates.add(current_date)
                current_date += timedelta(days=1)
            return

        account_ids = [int(account.id) for account in self.repo.list_accounts(include_inactive=False)]
        if not account_ids:
            return
        existing_pairs = {(int(row.account_id), row.snapshot_date) for row in existing_rows}
        current_date = start_date
        while current_date <= as_of_date:
            if not all((aid, current_date) in existing_pairs for aid in account_ids):
                self.portfolio_service.get_portfolio_snapshot(
                    account_id=None,
                    as_of=current_date,
                    cost_method=cost_method,
                    include_realtime=include_realtime,
                )
                for aid in account_ids:
                    existing_pairs.add((aid, current_date))
            current_date += timedelta(days=1)

    def _resolve_backfill_start_date(
        self,
        *,
        account_id: Optional[int],
        as_of_date: date,
        lookback_days: int,
    ) -> date:
        window_start = as_of_date - timedelta(days=lookback_days)
        if account_id is not None:
            first_activity = self.repo.get_first_activity_date(account_id=account_id, as_of=as_of_date)
            return max(window_start, first_activity or as_of_date)

        first_activity_candidates: List[date] = []
        for account in self.repo.list_accounts(include_inactive=False):
            first_activity = self.repo.get_first_activity_date(account_id=int(account.id), as_of=as_of_date)
            if first_activity is not None:
                first_activity_candidates.append(first_activity)
        if not first_activity_candidates:
            return as_of_date
        return max(window_start, min(first_activity_candidates))

    def _build_concentration(self, snapshot: Dict[str, Any], threshold_pct: float, *, as_of_date: date) -> Dict[str, Any]:
        total_mv = float(snapshot.get("total_market_value", 0.0) or 0.0)
        exposure_by_symbol: Dict[str, float] = {}
        for account in snapshot.get("accounts", []):
            for pos in account.get("positions", []):
                symbol = str(pos.get("symbol") or "").strip().upper()
                if not symbol:
                    continue
                market_value = float(pos.get("market_value_base") or 0.0)
                valuation_currency = str(pos.get("valuation_currency") or account.get("base_currency") or "CNY")
                converted, _, _ = self.portfolio_service.convert_amount(
                    amount=market_value,
                    from_currency=valuation_currency,
                    to_currency="CNY",
                    as_of_date=as_of_date,
                )
                exposure_by_symbol[symbol] = exposure_by_symbol.get(symbol, 0.0) + converted

        rows = []
        for symbol, exposure in exposure_by_symbol.items():
            weight = (exposure / total_mv * 100.0) if total_mv > 0 else 0.0
            rows.append(
                {
                    "symbol": symbol,
                    "market_value_base": round(exposure, 6),
                    "weight_pct": round(weight, 4),
                    "is_alert": bool(weight >= threshold_pct),
                }
            )
        rows.sort(key=lambda item: item["market_value_base"], reverse=True)

        top_weight = rows[0]["weight_pct"] if rows else 0.0
        return {
            "total_market_value": round(total_mv, 6),
            "top_weight_pct": round(float(top_weight), 4),
            "alert": bool(top_weight >= threshold_pct),
            "top_positions": rows,
        }

    def _build_sector_concentration(
        self,
        snapshot: Dict[str, Any],
        threshold_pct: float,
        *,
        as_of_date: date,
    ) -> Dict[str, Any]:
        total_mv = float(snapshot.get("total_market_value", 0.0) or 0.0)
        holdings: List[Dict[str, Any]] = []
        for account in snapshot.get("accounts", []):
            for pos in account.get("positions", []):
                symbol = str(pos.get("symbol") or "").strip().upper()
                if not symbol:
                    continue
                market = str(pos.get("market") or account.get("market") or "").strip().lower()
                market_value = float(pos.get("market_value_base") or 0.0)
                valuation_currency = str(pos.get("valuation_currency") or account.get("base_currency") or "CNY")
                converted, _, _ = self.portfolio_service.convert_amount(
                    amount=market_value,
                    from_currency=valuation_currency,
                    to_currency="CNY",
                    as_of_date=as_of_date,
                )
                holdings.append({"symbol": symbol, "market": market, "exposure": converted})

        resolved, failed_keys, errors = self._resolve_sector_names(holdings)

        coverage = {
            "classified_count": 0,
            "unclassified_count": 0,
            "failed_count": 0,
        }
        sector_exposure: Dict[str, float] = {}
        sector_symbols: Dict[str, set] = {}
        sector_by_key: Dict[Tuple[str, str], Optional[str]] = {}
        for item in holdings:
            key = (item["symbol"], item["market"])
            if key not in sector_by_key:
                sector_by_key[key] = self._resolve_primary_sector(
                    symbol=item["symbol"],
                    market=item["market"],
                    resolved=resolved,
                )
            sector = sector_by_key[key]
            if sector:
                coverage["classified_count"] += 1
            else:
                coverage["unclassified_count"] += 1
                if key in failed_keys:
                    coverage["failed_count"] += 1
                sector = "UNCLASSIFIED"
            sector_exposure[sector] = sector_exposure.get(sector, 0.0) + item["exposure"]
            sector_symbols.setdefault(sector, set()).add(item["symbol"])

        rows = []
        for sector, exposure in sector_exposure.items():
            weight = (exposure / total_mv * 100.0) if total_mv > 0 else 0.0
            rows.append(
                {
                    "sector": sector,
                    "market_value_base": round(exposure, 6),
                    "weight_pct": round(weight, 4),
                    "symbol_count": len(sector_symbols.get(sector, set())),
                    "is_alert": bool(weight >= threshold_pct),
                }
            )
        rows.sort(key=lambda item: item["market_value_base"], reverse=True)
        top_weight = rows[0]["weight_pct"] if rows else 0.0

        return {
            "total_market_value": round(total_mv, 6),
            "top_weight_pct": round(float(top_weight), 4),
            "alert": bool(top_weight >= threshold_pct),
            "top_sectors": rows,
            "coverage": coverage,
            "errors": errors,
        }

    def _resolve_sector_names(
        self,
        holdings: List[Dict[str, Any]],
    ) -> Tuple[Dict[Tuple[str, str], str], set, List[str]]:
        """Resolve industry names for the held A-share identities.

        Every lookup goes through the provider rate limiter, so the whole batch
        runs in parallel inside a hard wall-clock budget. Symbols that do not
        answer in time stay unresolved (reported as unclassified) and keep
        working in the background, which keeps the risk endpoint responsive even
        when an upstream data source hangs.
        """
        resolved: Dict[Tuple[str, str], str] = {}
        failed_keys: set = set()
        errors: List[str] = []
        pending: List[Tuple[str, str]] = []
        seen = set()

        for item in holdings:
            key = (item["symbol"], item["market"])
            if key in seen:
                continue
            seen.add(key)
            if key[1] != "cn" or not self._is_exchange_security(key[0]):
                continue
            if self._sector_negative_cache_hit(key[0]):
                continue
            pending.append(key)

        if not pending:
            return resolved, failed_keys, errors

        manager = self._get_data_manager()
        if manager is None:
            return resolved, failed_keys, errors

        budget = self._sector_lookup_budget_seconds()
        if budget <= 0:
            return resolved, failed_keys, errors

        executor = ThreadPoolExecutor(
            max_workers=max(1, min(self._SECTOR_LOOKUP_WORKERS, len(pending))),
            thread_name_prefix="dsa-sector",
        )
        try:
            futures = {
                executor.submit(self._fetch_belong_boards, key[0]): key
                for key in pending
            }
            done, _pending = wait(list(futures), timeout=budget)
            for future in done:
                key = futures[future]
                try:
                    boards = future.result()
                except Exception as exc:
                    failed_keys.add(key)
                    errors.append(f"{key[0]}: {exc}")
                    self._remember_sector_failure(key[0])
                    continue
                sector_name = self._pick_primary_board_name(boards)
                if sector_name:
                    resolved[key] = sector_name
                else:
                    self._remember_sector_failure(key[0])
        finally:
            # Never block the response on the provider rate limiter: abandoned
            # lookups finish in the background and warm the caches for the next
            # request.
            executor.shutdown(wait=False)

        if len(errors) > 20:
            errors = errors[:20]
        return resolved, failed_keys, errors

    @staticmethod
    def _is_exchange_security(symbol: str) -> bool:
        """Only exchange securities have board membership; funds/理财 do not."""
        return len(symbol) == 6 and symbol.isdigit()

    @staticmethod
    def _resolve_primary_sector(
        *,
        symbol: str,
        market: str,
        resolved: Dict[Tuple[str, str], str],
    ) -> Optional[str]:
        """Return the batch-resolved industry for one held identity."""
        return resolved.get((symbol, market))

    def _sector_lookup_budget_seconds(self) -> float:
        configured = getattr(
            self.config,
            "portfolio_risk_sector_budget_s",
            self._SECTOR_LOOKUP_BUDGET_SECONDS,
        )
        try:
            return max(0.0, float(configured))
        except (TypeError, ValueError):
            return self._SECTOR_LOOKUP_BUDGET_SECONDS

    def _sector_negative_cache_hit(self, symbol: str) -> bool:
        cls = self.__class__
        now = time.monotonic()
        with cls._belong_boards_failure_lock:
            expires_at = cls._belong_boards_failure_cache.get(symbol)
            if expires_at is None:
                return False
            if expires_at > now:
                return True
            cls._belong_boards_failure_cache.pop(symbol, None)
        return False

    def _remember_sector_failure(self, symbol: str) -> None:
        cls = self.__class__
        with cls._belong_boards_failure_lock:
            if len(cls._belong_boards_failure_cache) > 512:
                now = time.monotonic()
                for key in [key for key, exp in cls._belong_boards_failure_cache.items() if exp <= now]:
                    cls._belong_boards_failure_cache.pop(key, None)
            cls._belong_boards_failure_cache[symbol] = (
                time.monotonic() + cls._BELONG_BOARDS_FAILURE_TTL_SECONDS
            )

    @classmethod
    def clear_belong_boards_cache_for_tests(cls) -> None:
        with cls._belong_boards_cache_lock:
            cls._belong_boards_cache.clear()
        with cls._belong_boards_failure_lock:
            cls._belong_boards_failure_cache.clear()

    def _fetch_belong_boards(self, symbol: str) -> List[Dict[str, Any]]:
        cls = self.__class__
        now = time.monotonic()
        with cls._belong_boards_cache_lock:
            cached = cls._belong_boards_cache.get(symbol)
        if cached and cached[0] > now:
            return [dict(item) for item in cached[1]]

        manager = self._get_data_manager()
        if manager is None:
            return []
        result = manager.get_belong_boards(symbol)
        if not isinstance(result, list):
            return []
        if result:
            # Empty or failed lookups are not cached, so the next request retries them.
            expires_at = time.monotonic() + cls._BELONG_BOARDS_CACHE_TTL_SECONDS
            with cls._belong_boards_cache_lock:
                for key in [key for key, value in cls._belong_boards_cache.items() if value[0] <= now]:
                    cls._belong_boards_cache.pop(key, None)
                cls._belong_boards_cache[symbol] = (
                    expires_at,
                    [dict(item) for item in result if isinstance(item, dict)],
                )
        return result

    @staticmethod
    def _pick_primary_board_name(boards: List[Dict[str, Any]]) -> Optional[str]:
        if not boards:
            return None

        preferred: Optional[str] = None
        fallback: Optional[str] = None
        for item in boards:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or "").strip()
            if not name:
                continue
            if fallback is None:
                fallback = name
            type_text = str(item.get("type") or "").strip().lower()
            if "行业" in type_text or "industry" in type_text:
                preferred = name
                break
        return preferred or fallback

    def _get_data_manager(self):
        if self._data_manager is not None:
            return self._data_manager
        if self._data_manager_init_error:
            return None
        try:
            from data_provider import DataFetcherManager

            self._data_manager = DataFetcherManager()
            return self._data_manager
        except Exception as exc:  # pragma: no cover - fail-open initialization
            self._data_manager_init_error = str(exc)
            return None

    def _build_drawdown(
        self,
        *,
        account_id: Optional[int],
        as_of_date: date,
        cost_method: str,
        threshold_pct: float,
        lookback_days: int,
    ) -> Dict[str, Any]:
        rows = self.repo.list_daily_snapshots_for_risk(
            as_of=as_of_date,
            cost_method=cost_method,
            account_id=account_id,
            lookback_days=lookback_days,
        )
        if not rows:
            return {
                "series_points": 0,
                "max_drawdown_pct": 0.0,
                "current_drawdown_pct": 0.0,
                "alert": False,
                "fx_stale": False,
            }

        grouped: Dict[str, float] = {}
        stale_flag = False
        for row in rows:
            key = row.snapshot_date.isoformat()
            converted, stale, _ = self.portfolio_service.convert_amount(
                amount=float(row.total_equity or 0.0),
                from_currency=str(row.base_currency or "CNY"),
                to_currency="CNY",
                as_of_date=row.snapshot_date,
            )
            grouped[key] = grouped.get(key, 0.0) + converted
            stale_flag = stale_flag or stale or bool(row.fx_stale)

        series: List[Tuple[str, float]] = sorted(grouped.items(), key=lambda item: item[0])
        peak = 0.0
        max_drawdown = 0.0
        current_drawdown = 0.0
        for _, equity in series:
            peak = max(peak, equity)
            if peak <= 0:
                drawdown = 0.0
            else:
                drawdown = (peak - equity) / peak * 100.0
            max_drawdown = max(max_drawdown, drawdown)
            current_drawdown = drawdown

        return {
            "series_points": len(series),
            "max_drawdown_pct": round(max_drawdown, 4),
            "current_drawdown_pct": round(current_drawdown, 4),
            "alert": bool(max_drawdown >= threshold_pct),
            "fx_stale": stale_flag,
        }

    @staticmethod
    def _build_stop_loss(snapshot: Dict[str, Any], thresholds: Dict[str, Any]) -> Dict[str, Any]:
        stop_loss_pct = float(thresholds["stop_loss_alert_pct"])
        near_ratio = float(thresholds["stop_loss_near_ratio"])
        near_threshold = stop_loss_pct * near_ratio

        warnings: List[Dict[str, Any]] = []
        for account in snapshot.get("accounts", []):
            for pos in account.get("positions", []):
                avg_cost = float(pos.get("avg_cost", 0.0) or 0.0)
                last_price = float(pos.get("last_price", 0.0) or 0.0)
                if avg_cost <= 0:
                    continue
                loss_pct = max(0.0, (avg_cost - last_price) / avg_cost * 100.0)
                if loss_pct < near_threshold:
                    continue
                warnings.append(
                    {
                        "account_id": account.get("account_id"),
                        "symbol": pos.get("symbol"),
                        "avg_cost": round(avg_cost, 8),
                        "last_price": round(last_price, 8),
                        "loss_pct": round(loss_pct, 4),
                        "near_threshold_pct": round(near_threshold, 4),
                        "is_triggered": bool(loss_pct >= stop_loss_pct),
                    }
                )

        warnings.sort(key=lambda item: item["loss_pct"], reverse=True)
        return {
            "near_alert": len(warnings) > 0,
            "triggered_count": sum(1 for item in warnings if item["is_triggered"]),
            "near_count": len(warnings),
            "items": warnings,
        }
