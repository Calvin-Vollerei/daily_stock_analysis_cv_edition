# -*- coding: utf-8 -*-
"""Regression checks for desktop installer configuration."""

import json
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
DESKTOP_DIR = REPO_ROOT / "apps" / "dsa-desktop"


def test_windows_nsis_build_allows_custom_install_directory() -> None:
    package_json = json.loads((DESKTOP_DIR / "package.json").read_text(encoding="utf-8"))
    nsis = package_json.get("build", {}).get("nsis", {})

    assert nsis.get("oneClick") is False
    assert nsis.get("allowToChangeInstallationDirectory") is True
    assert nsis.get("allowElevation") is False
    assert nsis.get("include") == "installer.nsh"


def test_installer_does_not_abort_before_writing_files() -> None:
    """The edition keeps only the per-user install mode.

    The upstream directory guard aborted as soon as the chosen directory started
    with Program Files or the Windows directory. Under a per-user install into a
    custom directory that ran before the install section, so the installer quit
    without writing a single file. The guard is gone on purpose; assert the
    reduced contract instead, and assert the macro survives only in a comment.
    """
    installer_script = (DESKTOP_DIR / "installer.nsh").read_text(encoding="utf-8")

    assert "Function .onVerifyInstDir" not in installer_script
    assert "!macro customInstallMode" in installer_script
    assert "$isForceCurrentInstall 1" in installer_script


def test_installer_has_no_blocking_uninstall_retry_dialog() -> None:
    """A retry macro whose MessageBox has no silent fallback blocks /S forever.

    electron-builder's default uninstall handling is used instead, so the macro
    must not be defined (it may still be described in a comment).
    """
    installer_script = (DESKTOP_DIR / "installer.nsh").read_text(encoding="utf-8")

    assert "!macro _dsaRetryQuotedOldUninstall" not in installer_script
    assert '"_?=$R8"' not in installer_script


def test_windows_auto_updater_reuses_current_install_directory() -> None:
    main_js = (DESKTOP_DIR / "main.js").read_text(encoding="utf-8")

    assert "const installDirectory = path.dirname(app.getPath('exe'));" in main_js
    assert "updater.installDirectory = installDirectory;" in main_js
    assert 'updater.installDirectory = `"${installDirectory}"`' not in main_js
    assert "quoteNsisDirectoryArgument" not in main_js
