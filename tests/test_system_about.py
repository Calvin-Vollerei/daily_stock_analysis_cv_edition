# -*- coding: utf-8 -*-
"""Tests for the About and update-check endpoints."""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from api.app import create_app
from api.v1.endpoints import system_about


class _FakeResponse:
    def __init__(self, status_code: int, payload=None):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        if self._payload is None:
            raise ValueError("no payload")
        return self._payload


def test_version_key_orders_patch_suffixes() -> None:
    assert system_about._version_key("v3.35.0-cv-edition-patch2") > system_about._version_key("3.35.0-cv-edition-patch1")
    assert system_about._version_key("3.35.0") < system_about._version_key("3.36.0")
    assert system_about._version_key("v3.35.0") == system_about._version_key("3.35.0")


def test_about_reports_injected_desktop_version(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DSA_DESKTOP_VERSION", "3.35.0-cv-edition-patch2")
    client = TestClient(create_app())

    body = client.get("/api/v1/system/about").json()

    assert body["version"] == "3.35.0-cv-edition-patch2"
    assert body["version_source"] == "desktop"
    assert body["license"] == "MIT"
    assert body["repo_url"].startswith("https://github.com/")
    assert body["upstream_url"] == "https://github.com/ZhuLinsen/daily_stock_analysis"
    roles = {item["role"] for item in body["authors"]}
    assert roles == {"original", "adapter"}


def test_about_without_version_reports_unknown(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("DSA_DESKTOP_VERSION", raising=False)
    client = TestClient(create_app())

    body = client.get("/api/v1/system/about").json()

    assert body["version"] == ""
    assert body["version_source"] == "unknown"


def test_update_check_reports_update_when_tag_is_newer(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DSA_DESKTOP_VERSION", "3.35.0-cv-edition-patch1")
    monkeypatch.setattr(
        system_about.requests,
        "get",
        lambda *args, **kwargs: _FakeResponse(
            200,
            {
                "tag_name": "v3.35.0-cv-edition-patch2",
                "html_url": "https://github.com/x/y/releases/tag/v3.35.0-cv-edition-patch2",
                "name": "CV Edition patch2",
                "published_at": "2026-11-27T00:00:00Z",
            },
        ),
    )
    client = TestClient(create_app())

    body = client.get("/api/v1/system/update-check").json()

    assert body["current"] == "3.35.0-cv-edition-patch1"
    assert body["latest"] == "3.35.0-cv-edition-patch2"
    assert body["update_available"] is True
    assert body["error"] is None
    assert body["url"].endswith("v3.35.0-cv-edition-patch2")


def test_update_check_reports_up_to_date(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DSA_DESKTOP_VERSION", "3.35.0-cv-edition-patch2")
    monkeypatch.setattr(
        system_about.requests,
        "get",
        lambda *args, **kwargs: _FakeResponse(200, {"tag_name": "v3.35.0-cv-edition-patch2"}),
    )
    client = TestClient(create_app())

    body = client.get("/api/v1/system/update-check").json()

    assert body["update_available"] is False
    assert body["error"] is None


def test_update_check_reports_missing_release(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(system_about.requests, "get", lambda *args, **kwargs: _FakeResponse(404))
    client = TestClient(create_app())

    body = client.get("/api/v1/system/update-check").json()

    assert body["error"] == "no_release"
    assert body["update_available"] is False


def test_update_check_reports_network_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    def _raise(*args, **kwargs):
        raise system_about.requests.RequestException("boom")

    monkeypatch.setattr(system_about.requests, "get", _raise)
    client = TestClient(create_app())

    body = client.get("/api/v1/system/update-check").json()

    assert body["error"] == "network"
    assert body["update_available"] is False


# ------------------------- 角色主题（开机页立绘） -------------------------


def _ui_theme_file(tmp_path, monkeypatch: pytest.MonkeyPatch):
    target = tmp_path / "data" / "ui-theme.json"
    monkeypatch.setenv(system_about.UI_THEME_FILE_ENV, str(target))
    return target


def test_post_ui_theme_writes_character(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    target = _ui_theme_file(tmp_path, monkeypatch)
    client = TestClient(create_app())

    response = client.post("/api/v1/system/ui-theme", json={"character": "takakou"})

    assert response.status_code == 200
    body = response.json()
    assert body["character"] == "takakou"
    assert json.loads(target.read_text(encoding="utf-8")) == {"character": "takakou"}


def test_post_ui_theme_null_clears_character(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    target = _ui_theme_file(tmp_path, monkeypatch)
    client = TestClient(create_app())
    client.post("/api/v1/system/ui-theme", json={"character": "mochiko"})

    response = client.post("/api/v1/system/ui-theme", json={"character": None})

    assert response.status_code == 200
    assert response.json()["character"] is None
    assert json.loads(target.read_text(encoding="utf-8")) == {"character": None}


def test_post_ui_theme_normalizes_character_case(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    target = _ui_theme_file(tmp_path, monkeypatch)
    client = TestClient(create_app())

    response = client.post("/api/v1/system/ui-theme", json={"character": "  Kurumi "})

    assert response.status_code == 200
    assert json.loads(target.read_text(encoding="utf-8")) == {"character": "kurumi"}


def test_post_ui_theme_rejects_unknown_character(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    target = _ui_theme_file(tmp_path, monkeypatch)
    client = TestClient(create_app())

    response = client.post("/api/v1/system/ui-theme", json={"character": "not-a-character"})

    assert response.status_code == 400
    assert not target.exists()


def test_ui_theme_file_defaults_to_cwd(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    monkeypatch.delenv(system_about.UI_THEME_FILE_ENV, raising=False)
    monkeypatch.chdir(tmp_path)

    assert system_about.ui_theme_file_path() == tmp_path / "ui-theme.json"
