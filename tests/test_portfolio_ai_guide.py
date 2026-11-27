# -*- coding: utf-8 -*-
"""Tests for the AI import guide resolver and endpoint."""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api.app import create_app
from src.services import portfolio_ai_guide


def test_resolve_finds_guide_in_cwd_docs(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    docs = tmp_path / "docs"
    docs.mkdir()
    guide = docs / portfolio_ai_guide.GUIDE_FILENAME
    guide.write_text("# guide\n", encoding="utf-8")

    monkeypatch.delenv(portfolio_ai_guide.ENV_OVERRIDE, raising=False)
    monkeypatch.chdir(tmp_path)

    assert portfolio_ai_guide.resolve_ai_import_guide() == guide.resolve()


def test_resolve_honours_env_override(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    custom = tmp_path / "custom-guide.md"
    custom.write_text("# custom\n", encoding="utf-8")

    monkeypatch.setenv(portfolio_ai_guide.ENV_OVERRIDE, str(custom))
    monkeypatch.chdir(tmp_path)

    assert portfolio_ai_guide.resolve_ai_import_guide() == custom.resolve()


def test_resolve_returns_none_when_absent(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(portfolio_ai_guide.ENV_OVERRIDE, raising=False)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(portfolio_ai_guide, "_candidate_paths", lambda: [tmp_path / "nope.md"])

    assert portfolio_ai_guide.resolve_ai_import_guide() is None


def test_endpoint_reports_missing_guide(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "api.v1.endpoints.portfolio.resolve_ai_import_guide",
        lambda: None,
    )
    client = TestClient(create_app())
    response = client.get("/api/v1/portfolio/imports/ai-guide")

    assert response.status_code == 200
    body = response.json()
    assert body["available"] is False
    assert body["path"] is None
    assert body["filename"] == portfolio_ai_guide.GUIDE_FILENAME


def test_endpoint_returns_absolute_path(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    guide = tmp_path / portfolio_ai_guide.GUIDE_FILENAME
    guide.write_text("# guide\n", encoding="utf-8")

    monkeypatch.setattr(
        "api.v1.endpoints.portfolio.resolve_ai_import_guide",
        lambda: guide,
    )
    client = TestClient(create_app())
    response = client.get("/api/v1/portfolio/imports/ai-guide")

    assert response.status_code == 200
    body = response.json()
    assert body["available"] is True
    assert body["filename"] == portfolio_ai_guide.GUIDE_FILENAME
    assert os.path.isabs(body["path"])
    assert Path(body["path"]).name == portfolio_ai_guide.GUIDE_FILENAME
