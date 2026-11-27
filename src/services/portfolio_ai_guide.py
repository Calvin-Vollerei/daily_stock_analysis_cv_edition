# -*- coding: utf-8 -*-
"""Locate the AI import guide that ships with the application.

The guide is a Markdown handbook written for an external AI assistant. The
desktop UI copies its absolute path to the clipboard so the user can paste it
into any assistant. Four layouts have to work:

* a source checkout, where the file lives in ``<repo>/docs``
* a PyInstaller one-dir build, where datas land in ``<_internal>/docs``
* a PyInstaller frozen process, which exposes ``sys._MEIPASS``
* an operator override via ``PORTFOLIO_AI_IMPORT_GUIDE``
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import List, Optional

GUIDE_FILENAME = "portfolio-ai-import.md"
ENV_OVERRIDE = "PORTFOLIO_AI_IMPORT_GUIDE"


def _candidate_paths() -> List[Path]:
    candidates: List[Path] = []

    override = (os.getenv(ENV_OVERRIDE) or "").strip()
    if override:
        candidates.append(Path(override).expanduser())

    seen = set()

    def add(base: Optional[Path]) -> None:
        if base is None:
            return
        for rel in ((GUIDE_FILENAME,), ("docs", GUIDE_FILENAME), ("_internal", "docs", GUIDE_FILENAME)):
            path = base.joinpath(*rel)
            key = str(path).lower()
            if key in seen:
                continue
            seen.add(key)
            candidates.append(path)

    add(Path.cwd())
    add(Path(__file__).resolve().parents[2])

    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        add(Path(meipass))

    if getattr(sys, "frozen", False):
        add(Path(sys.executable).resolve().parent)

    return candidates


def resolve_ai_import_guide() -> Optional[Path]:
    """Return the first existing guide file, or ``None`` when none is found."""
    for path in _candidate_paths():
        try:
            if path.is_file():
                return path.resolve()
        except OSError:
            continue
    return None
