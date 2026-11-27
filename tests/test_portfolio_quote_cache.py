# -*- coding: utf-8 -*-
"""Quote-cache refresh contract for the portfolio snapshot.

Two behaviours are user-visible and must not regress:

* the request that starts a refresh cycle has to answer with the prices that
  cycle fetched, not with the previous cycle's (now stale) cache entry —
  otherwise a single click on "Refresh" silently shows old numbers;
* an explicit refresh (``force=True``) re-fetches symbols even while their cache
  entry is still inside the TTL window.
"""

from __future__ import annotations

import threading
import time

from src.services.portfolio_quote_cache import PortfolioQuoteCache


def _wait_until(predicate, timeout: float = 3.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.01)
    return False


def _settle(cache: PortfolioQuoteCache) -> None:
    """Wait until no refresh thread is running, so the next call starts a cycle."""
    assert _wait_until(lambda: cache.state()["refreshing"] is False)


def test_refresh_request_waits_for_its_own_quote() -> None:
    cache = PortfolioQuoteCache(ttl_seconds=0.05, wait_seconds=2.0, failure_backoff_seconds=0.0)
    prices = iter([10.0, 20.0])

    def fetch(symbol: str):
        # Slow enough that the caller really has to wait for the new price.
        time.sleep(0.2)
        return next(prices), "unit-test"

    assert cache.ensure_refresh(["600519"], fetch) is True
    assert cache.wait_for(["600519"], timeout=2.0) > 0.0
    assert cache.prices(["600519"]) == {"600519": (10.0, "unit-test")}
    _settle(cache)

    # Past the TTL the cached entry is stale; the next request refreshes it.
    time.sleep(0.08)
    assert cache.ensure_refresh(["600519"], fetch) is True
    waited = cache.wait_for(["600519"], timeout=2.0)
    assert waited > 0.0, "the caller that triggered the refresh must wait for the new quote"
    assert cache.prices(["600519"])["600519"][0] == 20.0


def test_force_refresh_bypasses_fresh_cache_entry() -> None:
    cache = PortfolioQuoteCache(ttl_seconds=60.0, wait_seconds=2.0)
    calls: list[str] = []

    def fetch(symbol: str):
        calls.append(symbol)
        return 10.0 + len(calls), "unit-test"

    assert cache.ensure_refresh(["600519"], fetch) is True
    cache.wait_for(["600519"], timeout=2.0)
    assert cache.prices(["600519"])["600519"][0] == 11.0
    _settle(cache)

    # Inside the TTL a plain request must not touch the provider chain.
    assert cache.ensure_refresh(["600519"], fetch) is False
    assert cache.wait_for(["600519"], timeout=2.0) == 0.0
    assert cache.prices(["600519"])["600519"][0] == 11.0

    # An explicit user refresh does re-fetch, and the caller sees the new price.
    assert cache.ensure_refresh(["600519"], fetch, force=True) is True
    cache.wait_for(["600519"], timeout=2.0)
    assert cache.prices(["600519"])["600519"][0] == 12.0
    assert calls == ["600519", "600519"]


def test_failed_symbol_backs_off_instead_of_stalling_the_cycle() -> None:
    """Symbols that never price must not eat other symbols' budget."""
    cache = PortfolioQuoteCache(ttl_seconds=60.0, wait_seconds=0.4, failure_backoff_seconds=60.0)
    release = threading.Event()

    def fetch(symbol: str):
        if symbol == "004043":
            release.wait(timeout=2.0)
            return None, None
        return 2.5, "unit-test"

    assert cache.ensure_refresh(["004043", "510300"], fetch) is True
    started = time.monotonic()
    cache.wait_for(["004043", "510300"], timeout=0.4)
    elapsed = time.monotonic() - started
    assert cache.prices(["510300"])["510300"][0] == 2.5
    assert elapsed < 0.6
    release.set()
    assert _wait_until(lambda: "004043" in cache.state()["backoff_symbols"])
    assert cache.get("004043") is None
