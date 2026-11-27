# -*- coding: utf-8 -*-
"""About and update-check endpoints for the CV Edition.

The edition ships its own release channel, so the update check asks the fork's
own repository rather than upstream. Both endpoints stay read-only and never
raise on a missing version or an unreachable GitHub: the UI needs a message, not
a 500.

It also persists the desktop character-theme choice (``POST /ui-theme``). The
desktop splash page runs from ``file://`` and cannot read the web page's
localStorage, so the web UI writes the choice to a small JSON file that the
Electron main process reads before opening ``loading.html``.
"""

from __future__ import annotations

import json
import logging
import os
import re
from pathlib import Path
from typing import Optional, Tuple

import requests
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from api.v1.schemas.system_about import AboutAuthor, AboutResponse, UpdateCheckResponse

logger = logging.getLogger(__name__)

router = APIRouter()

DEFAULT_REPO = "Calvin-Vollerei/daily_stock_analysis_cv_edition"
DEFAULT_UPSTREAM_REPO = "ZhuLinsen/daily_stock_analysis"
DEFAULT_ADAPTER = "Calvin Vollerei Studio"
DEFAULT_ADAPTER_URL = "https://github.com/Calvin-Vollerei"
GITHUB_TIMEOUT_SECONDS = 8.0

# Character themes: values must match CHARACTER_THEME_IDS in
# apps/dsa-web/src/themes/characterThemes.ts.
CHARACTER_THEME_IDS = ("takakou", "mebuki", "mochiko", "kurumi")
# Injected by the desktop main process next to DATABASE_PATH; a bare backend
# (dev / tests) falls back to <cwd>/ui-theme.json.
UI_THEME_FILE_ENV = "DSA_UI_THEME_FILE"
UI_THEME_FILE_NAME = "ui-theme.json"


def _env(name: str, default: str = "") -> str:
    return (os.getenv(name) or "").strip() or default


# ------------------------- character theme (desktop splash) -------------------------


class UiThemePayload(BaseModel):
    """``character`` is a theme id; ``null`` means "no character chosen"."""

    character: Optional[str] = Field(default=None, description="character theme id or null")


class UiThemeResponse(BaseModel):
    character: Optional[str] = None
    file: str = ""


def normalize_character_id(value: Optional[str]) -> Optional[str]:
    """Validate a character id; empty input returns ``None`` (no character chosen)."""
    if value is None:
        return None
    text = value.strip().lower()
    if not text:
        return None
    return text if text in CHARACTER_THEME_IDS else None


def ui_theme_file_path() -> Path:
    """Desktop injects ``DSA_UI_THEME_FILE``; otherwise fall back to ``<cwd>/ui-theme.json``."""
    configured = _env(UI_THEME_FILE_ENV)
    if configured:
        return Path(configured).expanduser()
    return Path.cwd() / UI_THEME_FILE_NAME


def write_ui_theme_file(path: Path, character: Optional[str]) -> None:
    """Write ``{"character": ...}`` atomically so a reader never sees half a JSON file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_name(path.name + ".tmp")
    tmp_path.write_text(
        json.dumps({"character": character}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    os.replace(tmp_path, path)


@router.post("/ui-theme", response_model=UiThemeResponse, summary="Persist the character theme for the desktop splash")
def set_ui_theme(payload: UiThemePayload) -> UiThemeResponse:
    """Persist the character chosen in the web UI so the desktop splash can draw it.

    The caller is fire-and-forget (a failed write must not block the theme
    switch), but the failure is still reported instead of silently dropped.
    """
    character = normalize_character_id(payload.character)
    if character is None and payload.character:
        raise HTTPException(status_code=400, detail="unknown character theme")

    path = ui_theme_file_path()
    try:
        write_ui_theme_file(path, character)
    except OSError as exc:
        logger.warning("Failed to persist ui theme to %s: %s", path, exc)
        raise HTTPException(status_code=500, detail="failed to persist ui theme") from exc

    return UiThemeResponse(character=character, file=str(path))


def current_version() -> Tuple[str, str]:
    """Return ``(version, source)``.

    The desktop main process injects its own ``app.getVersion()``; a bare backend
    has no package version, so an empty value is reported instead of a guess.
    """
    desktop = _env("DSA_DESKTOP_VERSION")
    if desktop:
        return desktop, "desktop"
    return "", "unknown"


def _version_key(value: str) -> Tuple[Tuple[int, ...], str]:
    """Comparable key for tags such as ``v3.35.0-cv-edition-patch3``."""
    text = (value or "").strip().lower().lstrip("v")
    match = re.match(r"^(\d+(?:\.\d+)*)(.*)$", text)
    if not match:
        return ((), text)
    numbers = tuple(int(part) for part in match.group(1).split(".") if part.isdigit())
    return (numbers, match.group(2))


def _repo() -> str:
    return _env("DSA_UPDATE_REPO", DEFAULT_REPO)


@router.get("/about", response_model=AboutResponse, summary="Edition version and credits")
def get_about() -> AboutResponse:
    """Version of the running edition plus the credit block the About page shows."""
    version, source = current_version()
    repo = _repo()
    upstream = _env("DSA_UPSTREAM_REPO", DEFAULT_UPSTREAM_REPO)
    adapter = _env("DSA_ADAPTER_NAME", DEFAULT_ADAPTER)
    adapter_url = _env("DSA_ADAPTER_URL", DEFAULT_ADAPTER_URL)

    return AboutResponse(
        version=version,
        version_source=source,
        repo=repo,
        repo_url=f"https://github.com/{repo}",
        upstream_repo=upstream,
        upstream_url=f"https://github.com/{upstream}",
        license="MIT",
        authors=[
            AboutAuthor(
                role="original",
                name=upstream.split("/")[0],
                url=f"https://github.com/{upstream}",
                note="upstream project, MIT licensed",
            ),
            AboutAuthor(
                role="adapter",
                name=adapter,
                url=adapter_url,
                note="CV Edition distribution and maintenance",
            ),
        ],
    )


def _api_release(repo: str) -> Optional[dict]:
    """Ask the GitHub API for the newest release; ``None`` means "fall back"."""
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "dsa-cv-edition"}
    token = _env("DSA_UPDATE_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    try:
        response = requests.get(
            f"https://api.github.com/repos/{repo}/releases/latest",
            timeout=GITHUB_TIMEOUT_SECONDS,
            headers=headers,
        )
    except requests.RequestException as exc:
        logger.warning("Update check failed for %s: %s", repo, exc)
        return None
    if response.status_code != 200:
        logger.info("Update check API returned HTTP %s for %s", response.status_code, repo)
        return None
    try:
        return response.json()
    except ValueError:
        return None


def _redirect_tag(repo: str) -> Tuple[Optional[str], Optional[str]]:
    """Read the tag from ``/releases/latest``'s redirect.

    The HTML endpoint is not rate limited the way the API is, so it keeps the
    check working for anonymous installs that have exhausted the API quota.
    Returns ``(tag, error)`` — the caller needs to tell "no release yet" apart
    from "network unreachable".
    """
    try:
        response = requests.get(
            f"https://github.com/{repo}/releases/latest",
            timeout=GITHUB_TIMEOUT_SECONDS,
            headers={"User-Agent": "dsa-cv-edition"},
            allow_redirects=False,
        )
    except requests.RequestException as exc:
        logger.warning("Update check redirect failed for %s: %s", repo, exc)
        return None, "network"
    if response.status_code == 404:
        return None, "no_release"
    if response.status_code not in (301, 302, 303, 307, 308):
        logger.info("Update check redirect returned HTTP %s for %s", response.status_code, repo)
        return None, "network"
    location = response.headers.get("Location") or ""
    match = re.search(r"/releases/tag/([^/?#]+)", location)
    if not match:
        return None, "no_release"
    return match.group(1), None


@router.get("/update-check", response_model=UpdateCheckResponse, summary="Check the edition release channel")
def check_update() -> UpdateCheckResponse:
    """Compare the running version with the newest release of the fork."""
    version, _ = current_version()
    repo = _repo()
    base = UpdateCheckResponse(current=version, repo=repo)

    payload = _api_release(repo)
    if payload is not None:
        tag = str(payload.get("tag_name") or "").strip()
        latest_version = tag.lstrip("v")
        base.latest = latest_version or tag
        base.url = payload.get("html_url")
        base.name = payload.get("name") or tag
        base.published_at = payload.get("published_at")
    else:
        tag, redirect_error = _redirect_tag(repo)
        if not tag:
            base.error = redirect_error or "network"
            return base
        latest_version = tag.lstrip("v")
        base.latest = latest_version or tag
        base.url = f"https://github.com/{repo}/releases/tag/{tag}"
        base.name = tag

    base.update_available = bool(latest_version) and bool(version) and (
        _version_key(latest_version) > _version_key(version)
    )
    return base
