# -*- coding: utf-8 -*-
"""About / update-check schemas (CV Edition)."""

from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


class AboutAuthor(BaseModel):
    """One line of the credit block: who, what role, which repository."""

    role: str
    name: str
    url: Optional[str] = None
    note: Optional[str] = None


class AboutResponse(BaseModel):
    version: str = ""
    version_source: str = "unknown"
    repo: str = ""
    repo_url: str = ""
    upstream_repo: str = ""
    upstream_url: str = ""
    license: str = "MIT"
    authors: List[AboutAuthor] = Field(default_factory=list)


class UpdateCheckResponse(BaseModel):
    current: str = ""
    latest: str = ""
    update_available: bool = False
    url: Optional[str] = None
    name: Optional[str] = None
    published_at: Optional[str] = None
    repo: str = ""
    error: Optional[str] = None
