# -*- coding: utf-8 -*-
"""Cache-first realtime quotes for portfolio holdings.

The portfolio snapshot must never block on live quote fetches: a cold quote
chain (five providers x N symbols, where bank wealth products can never be
quoted at all) used to hold the first request for more than a minute. Instead:

* the snapshot reads whatever is already cached (instant) and falls back to the
  repository's latest close,
* one single-flight background refresher fills the cache,
* a cold cache only waits a short, bounded budget so the first screen still
  arrives in about a second.

The cache is process-local because it only mirrors quotes that the data
provider layer already keeps in memory for the current run.
"""

from __future__ import annotations

import logging
import os
import re
import threading
import time
from dataclasses import dataclass
from typing import Callable, Dict, Iterable, List, Optional, Tuple

logger = logging.getLogger(__name__)

DEFAULT_CACHE_TTL_SECONDS = 60.0
DEFAULT_WAIT_SECONDS = 1.5
DEFAULT_FAILURE_BACKOFF_SECONDS = 300.0
# Enough workers so every quotable holding of a normal portfolio starts at once:
# OTC fund codes burn the full provider chain before failing, and serializing
# behind them would delay the exchange-traded prices that do resolve in ~1s.
# Anything above this risks provider rate limiting.
PORTFOLIO_QUOTE_MAX_WORKERS = 8

# Exchange-traded / exchange-listed codes that a realtime provider can answer.
# Custom pseudo symbols such as ``GOLD_ICBC`` or ``WMP_HZ2002`` are priced by
# external bank sync scripts, never by a quote provider: asking for them costs
# a full provider fallback chain per symbol and always fails.
_CN_CODE_RE = re.compile(r"^(?:SH|SZ|BJ)?\d{6}$")
_HK_CODE_RE = re.compile(r"^(?:HK)?\d{5}$")
_GLOBAL_CODE_RE = re.compile(r"^[A-Z][A-Z0-9.\-]{0,9}$")


def _env_float(name: str, default: float) -> float:
    raw = (os.getenv(name) or "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        logger.warning("Invalid %s=%r; using default %s", name, raw, default)
        return default


def is_realtime_quotable(symbol: str) -> bool:
    """Whether a portfolio symbol can be priced by the realtime quote chain."""
    code = (symbol or "").strip().upper()
    if not code or "_" in code:
        return False
    return bool(
        _CN_CODE_RE.match(code)
        or _HK_CODE_RE.match(code)
        or _GLOBAL_CODE_RE.match(code)
    )


@dataclass(frozen=True)
class CachedQuote:
    price: float
    provider: Optional[str]
    fetched_at: float

    def is_fresh(self, ttl_seconds: float) -> bool:
        return (time.time() - self.fetched_at) <= ttl_seconds

    def fetched_on(self) -> str:
        return time.strftime("%Y-%m-%d", time.localtime(self.fetched_at))


class PortfolioQuoteCache:
    """Thread-safe realtime quote cache with a single-flight background refresher."""

    def __init__(
        self,
        *,
        ttl_seconds: Optional[float] = None,
        wait_seconds: Optional[float] = None,
        failure_backoff_seconds: Optional[float] = None,
    ):
        self._ttl = float(
            ttl_seconds
            if ttl_seconds is not None
            else _env_float("PORTFOLIO_QUOTE_CACHE_TTL_SECONDS", DEFAULT_CACHE_TTL_SECONDS)
        )
        self._wait = float(
            wait_seconds
            if wait_seconds is not None
            else _env_float("PORTFOLIO_QUOTE_WAIT_SECONDS", DEFAULT_WAIT_SECONDS)
        )
        self._failure_backoff = float(
            failure_backoff_seconds
            if failure_backoff_seconds is not None
            else _env_float("PORTFOLIO_QUOTE_FAILURE_BACKOFF_SECONDS", DEFAULT_FAILURE_BACKOFF_SECONDS)
        )
        self._condition = threading.Condition()
        self._quotes: Dict[str, CachedQuote] = {}
        self._pending: set[str] = set()
        self._fail_until: Dict[str, float] = {}
        self._thread: Optional[threading.Thread] = None
        self._cycle_id = 0
        self._waited_cycle_id = -1
        self._last_started_at: Optional[float] = None
        self._last_finished_at: Optional[float] = None
        self._last_requested: List[str] = []
        self._last_failed: List[str] = []
        self._last_priced: List[str] = []

    # ------------------------------------------------------------------
    # Read side
    # ------------------------------------------------------------------
    @property
    def wait_seconds(self) -> float:
        return self._wait

    @property
    def ttl_seconds(self) -> float:
        return self._ttl

    def get(self, symbol: str) -> Optional[CachedQuote]:
        with self._condition:
            return self._quotes.get(symbol)

    def snapshot(self, symbols: Iterable[str]) -> Dict[str, CachedQuote]:
        with self._condition:
            return {
                symbol: self._quotes[symbol]
                for symbol in symbols
                if symbol and symbol in self._quotes
            }

    def prices(self, symbols: Iterable[str]) -> Dict[str, Tuple[float, Optional[str]]]:
        wanted = {symbol for symbol in symbols if symbol}
        with self._condition:
            return {
                symbol: (quote.price, quote.provider)
                for symbol, quote in self._quotes.items()
                if symbol in wanted
            }

    def state(self) -> Dict[str, object]:
        with self._condition:
            now = time.time()
            return {
                "cached": len(self._quotes),
                "pending": sorted(self._pending),
                "refreshing": bool(self._thread and self._thread.is_alive()),
                "cycle_id": self._cycle_id,
                "ttl_seconds": self._ttl,
                "wait_seconds": self._wait,
                "last_started_at": self._last_started_at,
                "last_finished_at": self._last_finished_at,
                "last_requested": list(self._last_requested),
                "last_priced": list(self._last_priced),
                "last_failed": list(self._last_failed),
                "backoff_symbols": sorted(
                    symbol for symbol, until in self._fail_until.items() if until > now
                ),
            }

    # ------------------------------------------------------------------
    # Refresh side
    # ------------------------------------------------------------------
    def ensure_refresh(
        self,
        symbols: Iterable[str],
        fetch: Callable[[str], Tuple[Optional[float], Optional[str]]],
        *,
        force: bool = False,
        quotable_only: bool = True,
    ) -> bool:
        """Start one background refresh cycle. Returns True when a cycle started.

        Never raises and never blocks on the network. Symbols that are fresh,
        backing off after a failure, or already pending are skipped.
        """
        ordered = sorted({str(symbol).strip() for symbol in symbols if symbol})
        if quotable_only:
            ordered = [symbol for symbol in ordered if is_realtime_quotable(symbol)]
        if not ordered or fetch is None:
            return False

        with self._condition:
            now = time.time()
            targets: List[str] = []
            for symbol in ordered:
                cached = self._quotes.get(symbol)
                if cached is not None and cached.is_fresh(self._ttl) and not force:
                    continue
                if self._fail_until.get(symbol, 0.0) > now:
                    continue
                if symbol in self._pending:
                    continue
                targets.append(symbol)
            if not targets:
                return False
            if self._thread is not None and self._thread.is_alive():
                # Single flight: the running cycle owns the provider chain.
                return False
            self._pending.update(targets)
            self._cycle_id += 1
            self._last_started_at = now
            self._last_requested = list(targets)
            self._last_priced = []
            self._last_failed = []
            thread = threading.Thread(
                target=self._run,
                args=(targets, fetch),
                name="portfolio-quote-refresh",
                daemon=True,
            )
            self._thread = thread

        thread.start()
        logger.info(
            "[portfolio quotes] refresh started symbols=%d: %s",
            len(targets),
            ",".join(targets),
        )
        return True

    def wait_for(self, symbols: Iterable[str], timeout: Optional[float] = None) -> float:
        """Wait at most ``timeout`` seconds until pending symbols are resolved.

        Only the first caller of a refresh cycle waits: the cycle keeps running
        in the background, so a second view (or the risk endpoint right after the
        snapshot) would only pay the same latency again for stragglers such as
        OTC funds, which never resolve on the realtime chain.
        """
        pending = [symbol for symbol in symbols if symbol]
        if not pending:
            return 0.0
        with self._condition:
            outstanding = [
                symbol
                for symbol in pending
                if symbol in self._pending and symbol not in self._quotes
            ]
            if not outstanding or self._waited_cycle_id == self._cycle_id:
                return 0.0
            self._waited_cycle_id = self._cycle_id
        budget = self._wait if timeout is None else max(0.0, float(timeout))
        started = time.monotonic()
        deadline = started + budget
        with self._condition:
            while True:
                outstanding = [
                    symbol
                    for symbol in pending
                    if symbol in self._pending and symbol not in self._quotes
                ]
                if not outstanding:
                    break
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    break
                self._condition.wait(min(0.1, remaining))
        return time.monotonic() - started

    def _run(
        self,
        symbols: List[str],
        fetch: Callable[[str], Tuple[Optional[float], Optional[str]]],
    ) -> None:
        from concurrent.futures import ThreadPoolExecutor, as_completed

        priced: List[str] = []
        failed: List[str] = []
        max_workers = max(1, min(PORTFOLIO_QUOTE_MAX_WORKERS, len(symbols)))
        try:
            with ThreadPoolExecutor(
                max_workers=max_workers, thread_name_prefix="portfolio-quote"
            ) as executor:
                futures = {executor.submit(fetch, symbol): symbol for symbol in symbols}
                for future in as_completed(futures):
                    symbol = futures[future]
                    price: Optional[float] = None
                    provider: Optional[str] = None
                    try:
                        price, provider = future.result()
                    except Exception as exc:  # noqa: BLE001 - one symbol must not break the cycle
                        logger.warning("Portfolio quote fetch failed for %s: %s", symbol, exc)
                    numeric = None
                    try:
                        numeric = float(price) if price is not None else None
                    except (TypeError, ValueError):
                        numeric = None
                    with self._condition:
                        self._pending.discard(symbol)
                        if numeric is not None and numeric > 0:
                            self._quotes[symbol] = CachedQuote(
                                price=numeric,
                                provider=provider,
                                fetched_at=time.time(),
                            )
                            self._fail_until.pop(symbol, None)
                            priced.append(symbol)
                        else:
                            self._fail_until[symbol] = time.time() + self._failure_backoff
                            failed.append(symbol)
                        self._condition.notify_all()
        except Exception as exc:  # noqa: BLE001 - refresher must never kill the process
            logger.warning("Portfolio quote refresh cycle failed: %s", exc)
        finally:
            with self._condition:
                for symbol in symbols:
                    self._pending.discard(symbol)
                self._thread = None
                self._last_finished_at = time.time()
                self._last_priced = sorted(priced)
                self._last_failed = sorted(failed)
                self._condition.notify_all()
            logger.info(
                "[portfolio quotes] refresh finished priced=%d failed=%d failed_symbols=%s",
                len(priced),
                len(failed),
                ",".join(sorted(failed)) or "-",
            )

    def reset(self) -> None:
        """Drop cached state (tests / profile switches)."""
        with self._condition:
            self._quotes.clear()
            self._pending.clear()
            self._fail_until.clear()
            self._thread = None
            self._cycle_id = 0
            self._waited_cycle_id = -1
            self._last_started_at = None
            self._last_finished_at = None
            self._last_requested = []
            self._last_priced = []
            self._last_failed = []
            self._condition.notify_all()


_QUOTE_CACHE: Optional[PortfolioQuoteCache] = None
_QUOTE_CACHE_LOCK = threading.Lock()


def get_quote_cache() -> PortfolioQuoteCache:
    global _QUOTE_CACHE
    with _QUOTE_CACHE_LOCK:
        if _QUOTE_CACHE is None:
            _QUOTE_CACHE = PortfolioQuoteCache()
        return _QUOTE_CACHE


def reset_quote_cache() -> None:
    """Reset the process-wide cache (test isolation)."""
    with _QUOTE_CACHE_LOCK:
        if _QUOTE_CACHE is not None:
            _QUOTE_CACHE.reset()


def held_symbols() -> List[str]:
    """Symbols of every currently held position, read without live quotes."""
    try:
        from src.services.portfolio_service import PortfolioService

        snapshot = PortfolioService().get_portfolio_snapshot(
            include_realtime=False,
            read_only=True,
        )
    except Exception as exc:  # noqa: BLE001 - warmup is best effort
        logger.warning("[portfolio quotes] cannot read holdings for warmup: %s", exc)
        return []

    symbols: List[str] = []
    for account in snapshot.get("accounts") or []:
        for position in account.get("positions") or []:
            symbol = str(position.get("symbol") or "").strip()
            try:
                quantity = float(position.get("quantity") or 0.0)
            except (TypeError, ValueError):
                quantity = 0.0
            if symbol and quantity > 0:
                symbols.append(symbol)
    return symbols


def warmup_portfolio_quotes(*, force: bool = True) -> bool:
    """Refresh quotes for all held symbols; used once per app start."""
    try:
        from src.services.portfolio_service import PortfolioService
    except Exception as exc:  # noqa: BLE001 - warmup is best effort
        logger.warning("[portfolio quotes] warmup unavailable: %s", exc)
        return False

    symbols = held_symbols()
    quotable = [symbol for symbol in symbols if is_realtime_quotable(symbol)]
    if not quotable:
        logger.info("[portfolio quotes] warmup skipped: no quotable holdings (held=%d)", len(symbols))
        return False

    started = get_quote_cache().ensure_refresh(
        quotable,
        PortfolioService.fetch_realtime_price,
        force=force,
    )
    logger.info(
        "[portfolio quotes] warmup symbols=%d quotable=%d started=%s",
        len(symbols),
        len(quotable),
        started,
    )
    return started
