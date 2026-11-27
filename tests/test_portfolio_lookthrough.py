# -*- coding: utf-8 -*-
"""Tests for the optional portfolio look-through endpoint and its sidecar fallback."""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
import urllib.error
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

# Keep this test runnable when optional LLM runtime deps are not installed.
try:
    import litellm  # noqa: F401
except ModuleNotFoundError:
    sys.modules["litellm"] = MagicMock()

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.v1.endpoints.portfolio import router as portfolio_router
from src.services.portfolio_sector_layer import (
    _is_lookthrough_payload,
    build_lookthrough_url,
    load_local_lookthrough,
)

LOOKTHROUGH_URL = "/api/v1/portfolio/lookthrough"


def _payload(stock_count: int = 297, *, weight_pct: float = 20.05) -> dict:
    return {
        "generated_at": "2026-11-26T20:39:00+08:00",
        "total_market_value": 159823.97,
        "stock_count": stock_count,
        "penetrated_market_value": 32044.71,
        "penetrated_weight_pct": weight_pct,
        "coverage": {
            "penetrated_pct": weight_pct,
            "unpenetrated_pct": 5.09,
            "fixed_income_pct": 31.42,
            "non_equity_pct": 43.45,
        },
        "stocks": [
            {
                "code": "NVDA",
                "name": "英伟达",
                "market_value": 1894.77,
                "weight_pct": 1.1855,
                "via": [{"symbol": "513300", "name": "纳斯达克ETF华夏", "weight_pct": 7.41}],
            }
        ],
        "buckets": [],
        "positions": [],
    }


class _FakeResponse:
    """Minimal urllib response double for the sidecar hop."""

    def __init__(self, body: bytes, status: int = 200) -> None:
        self._body = body
        self.status = status

    def read(self) -> bytes:
        return self._body

    def __enter__(self) -> "_FakeResponse":
        return self

    def __exit__(self, *args) -> bool:
        return False


def _fake_urlopen(payload: dict, status: int = 200):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")

    def _open(request, timeout=None):  # noqa: ARG001 - signature parity with urllib
        return _FakeResponse(body, status)

    return _open


class _LookthroughTestCase(unittest.TestCase):
    def setUp(self) -> None:
        app = FastAPI()
        app.include_router(portfolio_router, prefix="/api/v1/portfolio")
        self.client = TestClient(app)
        self.temp_dir = tempfile.TemporaryDirectory()
        self.snapshot_path = Path(self.temp_dir.name) / "lookthrough.json"

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def _config(self, *, url: str = "", path: str | None = None) -> SimpleNamespace:
        return SimpleNamespace(
            portfolio_sector_layer_url=url,
            portfolio_sector_layer_timeout_s=2.0,
            portfolio_lookthrough_path=str(self.snapshot_path if path is None else path),
        )

    def _get(self, config: SimpleNamespace):
        with patch("api.v1.endpoints.portfolio.get_config", return_value=config):
            return self.client.get(LOOKTHROUGH_URL)

    def _write_snapshot(self, payload: dict) -> None:
        self.snapshot_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


class SidecarAvailableTests(_LookthroughTestCase):
    def test_sidecar_payload_is_passed_through(self) -> None:
        with patch("urllib.request.urlopen", _fake_urlopen(_payload(stock_count=42))):
            response = self._get(self._config(url="http://127.0.0.1:8799"))
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["stock_count"], 42)
        self.assertIn("weight_pct", body["stocks"][0])
        self.assertTrue(response.headers["content-type"].startswith("application/json"))

    def test_sidecar_payload_wins_over_local_snapshot(self) -> None:
        self._write_snapshot(_payload(stock_count=297))
        with patch("urllib.request.urlopen", _fake_urlopen(_payload(stock_count=7))):
            response = self._get(self._config(url="http://127.0.0.1:8799"))
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["stock_count"], 7)

    def test_invalid_sidecar_structure_falls_back_to_local_snapshot(self) -> None:
        self._write_snapshot(_payload(stock_count=297))
        broken = _payload()
        broken["stocks"] = "not-a-list"
        with patch("urllib.request.urlopen", _fake_urlopen(broken)):
            response = self._get(self._config(url="http://127.0.0.1:8799"))
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["stock_count"], 297)

    def test_sidecar_non_200_falls_back_to_local_snapshot(self) -> None:
        self._write_snapshot(_payload(stock_count=297))
        with patch("urllib.request.urlopen", _fake_urlopen(_payload(stock_count=7), status=503)):
            response = self._get(self._config(url="http://127.0.0.1:8799"))
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["stock_count"], 297)


class SidecarDownTests(_LookthroughTestCase):
    def test_sidecar_unreachable_reads_local_file(self) -> None:
        self._write_snapshot(_payload(stock_count=297))
        with patch("urllib.request.urlopen", side_effect=urllib.error.URLError("refused")):
            response = self._get(self._config(url="http://127.0.0.1:8799"))
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["stock_count"], 297)
        self.assertAlmostEqual(response.json()["penetrated_weight_pct"], 20.05)

    def test_sidecar_http_error_reads_local_file(self) -> None:
        self._write_snapshot(_payload(stock_count=297))
        error = urllib.error.HTTPError("url", 502, "bad gateway", None, None)  # type: ignore[arg-type]
        with patch("urllib.request.urlopen", side_effect=error):
            response = self._get(self._config(url="http://127.0.0.1:8799"))
        self.assertEqual(response.status_code, 200, response.text)

    def test_no_sidecar_configured_reads_local_file(self) -> None:
        self._write_snapshot(_payload(stock_count=297))
        response = self._get(self._config(url=""))
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["stock_count"], 297)

    def test_sidecar_and_file_missing_returns_404(self) -> None:
        response = self._get(self._config(url=""))
        self.assertEqual(response.status_code, 404, response.text)
        self.assertEqual(response.json()["detail"]["error"], "not_found")

    def test_sidecar_down_without_file_returns_404_not_500(self) -> None:
        with patch("urllib.request.urlopen", side_effect=urllib.error.URLError("refused")):
            response = self._get(self._config(url="http://127.0.0.1:8799"))
        self.assertEqual(response.status_code, 404, response.text)

    def test_invalid_local_snapshot_returns_404_not_500(self) -> None:
        self.snapshot_path.write_text("{not-json", encoding="utf-8")
        response = self._get(self._config(url=""))
        self.assertEqual(response.status_code, 404, response.text)

    def test_local_snapshot_with_wrong_shape_returns_404(self) -> None:
        self._write_snapshot({"stock_count": "297", "penetrated_weight_pct": 20.05})
        response = self._get(self._config(url=""))
        self.assertEqual(response.status_code, 404, response.text)

    def test_unexpected_sidecar_error_does_not_500(self) -> None:
        self._write_snapshot(_payload(stock_count=297))
        with patch("urllib.request.urlopen", side_effect=RuntimeError("boom")):
            response = self._get(self._config(url="http://127.0.0.1:8799"))
        self.assertEqual(response.status_code, 200, response.text)


class ServiceHelperTests(unittest.TestCase):
    def test_build_lookthrough_url(self) -> None:
        self.assertEqual(
            build_lookthrough_url("http://127.0.0.1:8799/"),
            "http://127.0.0.1:8799/api/v1/portfolio/lookthrough",
        )
        self.assertEqual(
            build_lookthrough_url("http://127.0.0.1:8799", account_id=3),
            "http://127.0.0.1:8799/api/v1/portfolio/lookthrough?account_id=3",
        )
        self.assertEqual(build_lookthrough_url(""), "")

    def test_payload_validation_rejects_bad_types(self) -> None:
        self.assertTrue(_is_lookthrough_payload(_payload()))
        for key, bad in (
            ("stock_count", True),
            ("stock_count", 297.0),
            ("penetrated_weight_pct", "20.05"),
            ("total_market_value", float("nan")),
            ("coverage", []),
            ("stocks", {}),
        ):
            payload = _payload()
            payload[key] = bad
            self.assertFalse(_is_lookthrough_payload(payload), f"{key}={bad!r} should be rejected")

    def test_load_local_snapshot_missing_returns_none(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            config = SimpleNamespace(portfolio_lookthrough_path=str(Path(tmp) / "absent.json"))
            self.assertIsNone(load_local_lookthrough(config))

    def test_frozen_exe_finds_snapshot_in_install_root(self) -> None:
        """Packaged backend runs with cwd=resources/backend/stock_analysis."""
        with tempfile.TemporaryDirectory() as tmp:
            app_root = Path(tmp) / "Daily Stock Analysis"
            exe_dir = app_root / "resources" / "backend" / "stock_analysis"
            exe_dir.mkdir(parents=True)
            snapshot = app_root / "sector-layer" / "lookthrough.json"
            snapshot.parent.mkdir(parents=True)
            snapshot.write_text(json.dumps(_payload(stock_count=11)), encoding="utf-8")

            config = SimpleNamespace(portfolio_lookthrough_path="")
            with patch("src.services.portfolio_sector_layer.sys") as fake_sys:
                fake_sys.frozen = True
                fake_sys.executable = str(exe_dir / "stock_analysis.exe")
                loaded = load_local_lookthrough(config)

        self.assertIsNotNone(loaded)
        self.assertEqual(loaded["stock_count"], 11)


if __name__ == "__main__":
    unittest.main()
