# -*- coding: utf-8 -*-
"""About and update-check endpoints for the CV Edition.

The edition ships its own release channel, so the update check asks the fork's
own repository rather than upstream. Both endpoints stay read-only and never
raise on a missing version or an unreachable GitHub: the UI needs a message, not
a 500.
"""

from __future__ import annotations

import logging
import os
import re
from typing import Optional, Tuple

import requests
from fastapi import APIRouter

from api.v1.schemas.system_about import AboutAuthor, AboutResponse, UpdateCheckResponse

logger = logging.getLogger(__name__)

router = APIRouter()

DEFAULT_REPO = "Calvin-Vollerei/daily_stock_analysis_cv_edition"
DEFAULT_UPSTREAM_REPO = "ZhuLinsen/daily_stock_analysis"
DEFAULT_ADAPTER = "Calvin Vollerei Studio"
DEFAULT_ADAPTER_URL = "https://github.com/Calvin-Vollerei"
GITHUB_TIMEOUT_SECONDS = 8.0


def _env(name: str, default: str = "") -> str:
    return (os.getenv(name) or "").strip() or default


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
    """Comparable key for tags such as ``v3.35.0-cv-edition-patch2``."""
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
