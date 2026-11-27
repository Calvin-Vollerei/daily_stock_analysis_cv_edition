# -*- coding: utf-8 -*-
"""Tests for the optional TZZB (investment ledger) portfolio sync.

Everything here is offline: the ledger endpoint is never contacted, the
credential file is a temporary fixture, and the sync command is only resolved,
never executed.
"""
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from src.config import Config
from src.core.config_registry import (
    WEB_SETTINGS_HIDDEN_FROM_UI,
    build_schema_response,
    get_field_definition,
)
from src.services import portfolio_sync_command
from src.services.tzzb_sync import (
    ACCOUNTS_ENV,
    AUTH_FILE_ENV,
    DEFAULT_MIN_INTERVAL_SECONDS,
    DEFAULT_TIMEOUT_SECONDS,
    ENDPOINT_ENV,
    TzzbSettings,
    build_child_env,
    load_settings,
    read_access_token,
    split_accounts,
    summarize_accounts,
)

LEDGER_KEYS = (
    "TZZB_SYNC_ENABLED",
    "TZZB_SYNC_COMMAND",
    "TZZB_MCP_ENDPOINT",
    "TZZB_MCP_AUTH_FILE",
    "TZZB_SYNC_ACCOUNTS",
    "TZZB_SYNC_MIN_INTERVAL_SECONDS",
    "TZZB_SYNC_TIMEOUT_SECONDS",
)

# Shape returned by the ledger `promptAccountSelection` MCP tool.
LEDGER_ACCOUNT_PAYLOAD = {
    "fund_key": [
        {
            "id": "193885689",
            "name": "股票账户",
            "param": "fundKey",
            "lastSyncTime": "2026-11-27 13:54:15",
        }
    ],
    "rzrq_fund_key": [],
    "manual_id": [],
    "fund_id": [
        {"id": "28084645", "name": "手工基金 - 支付宝", "param": "fundId", "lastSyncTime": "2026-11-26 21:10:00"}
    ],
    "cust_id": [],
}


class TestTzzbRegistryFields(unittest.TestCase):
    """The settings page is schema driven, so the keys must be registered."""

    def test_fields_registered_in_data_source(self):
        for key in LEDGER_KEYS:
            field = get_field_definition(key)
            self.assertEqual(field["category"], "data_source", f"{key} category")
            self.assertNotEqual(field["display_order"], 9000, f"{key} must be explicit")
            self.assertFalse(field["is_sensitive"], f"{key} is not a secret")

    def test_fields_visible_in_settings_schema(self):
        schema = build_schema_response()
        data_source = next(
            category for category in schema["categories"] if category["category"] == "data_source"
        )
        listed = {field["key"] for field in data_source["fields"]}
        for key in LEDGER_KEYS:
            self.assertIn(key, listed, f"{key} missing from data_source schema")
            self.assertNotIn(key, WEB_SETTINGS_HIDDEN_FROM_UI)

    def test_switch_defaults_to_off(self):
        field = get_field_definition("TZZB_SYNC_ENABLED")
        self.assertEqual(field["ui_control"], "switch")
        self.assertEqual(field["default_value"], "false")

    def test_interval_and_timeout_defaults_match_runtime_defaults(self):
        self.assertEqual(
            get_field_definition("TZZB_SYNC_MIN_INTERVAL_SECONDS")["default_value"],
            str(int(DEFAULT_MIN_INTERVAL_SECONDS)),
        )
        self.assertEqual(
            get_field_definition("TZZB_SYNC_TIMEOUT_SECONDS")["default_value"],
            str(int(DEFAULT_TIMEOUT_SECONDS)),
        )


class TestTzzbSettings(unittest.TestCase):
    def tearDown(self):
        Config.reset_instance()

    def test_disabled_by_default(self):
        with patch.dict(os.environ, {"STOCK_LIST": "600519"}, clear=True):
            settings = load_settings(Config._load_from_env())
        self.assertFalse(settings.enabled)
        self.assertFalse(settings.active)
        self.assertFalse(settings.has_command)
        self.assertFalse(settings.has_mcp)
        self.assertEqual(settings.min_interval_seconds, DEFAULT_MIN_INTERVAL_SECONDS)
        self.assertEqual(settings.timeout_seconds, DEFAULT_TIMEOUT_SECONDS)

    def test_enabled_without_access_method_stays_inactive(self):
        with patch.dict(
            os.environ,
            {"STOCK_LIST": "600519", "TZZB_SYNC_ENABLED": "true"},
            clear=True,
        ):
            settings = load_settings(Config._load_from_env())
        self.assertTrue(settings.enabled)
        self.assertFalse(settings.active)

    def test_command_and_mcp_settings_are_parsed(self):
        with patch.dict(
            os.environ,
            {
                "STOCK_LIST": "600519",
                "TZZB_SYNC_ENABLED": "true",
                "TZZB_SYNC_COMMAND": 'py -3 "C:\\tools\\tzzb-to-dsa.py"',
                "TZZB_MCP_ENDPOINT": "https://ledger.example/mcp",
                "TZZB_MCP_AUTH_FILE": "C:\\tools\\token.json",
                "TZZB_SYNC_ACCOUNTS": "193885689, 28084645 ,,",
                "TZZB_SYNC_MIN_INTERVAL_SECONDS": "60",
                "TZZB_SYNC_TIMEOUT_SECONDS": "30",
            },
            clear=True,
        ):
            settings = load_settings(Config._load_from_env())
        self.assertTrue(settings.active)
        self.assertEqual(settings.accounts, ("193885689", "28084645"))
        self.assertEqual(settings.min_interval_seconds, 60.0)
        self.assertEqual(settings.timeout_seconds, 30.0)

    def test_invalid_interval_falls_back_to_default(self):
        with patch.dict(
            os.environ,
            {
                "STOCK_LIST": "600519",
                "TZZB_SYNC_ENABLED": "true",
                "TZZB_SYNC_COMMAND": "py -3 bridge.py",
                "TZZB_SYNC_MIN_INTERVAL_SECONDS": "soon",
            },
            clear=True,
        ):
            settings = load_settings(Config._load_from_env())
        self.assertEqual(settings.min_interval_seconds, DEFAULT_MIN_INTERVAL_SECONDS)

    def test_split_accounts_accepts_multiple_separators(self):
        self.assertEqual(
            split_accounts("a, b;c\nd,, "),
            ("a", "b", "c", "d"),
        )
        self.assertEqual(split_accounts(None), ())

    def test_describe_never_leaks_secrets(self):
        settings = TzzbSettings(
            enabled=True,
            command="py -3 bridge.py",
            mcp_endpoint="https://ledger.example/mcp",
            mcp_auth_file="C:\\secret\\token.json",
            accounts=("193885689",),
        )
        described = settings.describe()
        self.assertIn("methods=command+mcp", described)
        self.assertIn("accounts=193885689", described)
        self.assertNotIn("secret", described)


class TestChildEnv(unittest.TestCase):
    def test_empty_settings_forward_nothing(self):
        self.assertEqual(build_child_env(TzzbSettings()), {})

    def test_configured_settings_are_forwarded(self):
        env = build_child_env(
            TzzbSettings(
                enabled=True,
                command="py -3 bridge.py",
                mcp_endpoint="https://ledger.example/mcp",
                mcp_auth_file="C:\\tools\\token.json",
                accounts=("193885689", "28084645"),
            )
        )
        self.assertEqual(env[ACCOUNTS_ENV], "193885689,28084645")
        self.assertEqual(env[ENDPOINT_ENV], "https://ledger.example/mcp")
        self.assertEqual(env[AUTH_FILE_ENV], "C:\\tools\\token.json")


class TestAccessToken(unittest.TestCase):
    def _write(self, payload):
        handle = tempfile.NamedTemporaryFile(
            "w", suffix=".json", delete=False, encoding="utf-8"
        )
        json.dump(payload, handle)
        handle.close()
        self.addCleanup(lambda: Path(handle.name).unlink(missing_ok=True))
        return handle.name

    def test_missing_file_returns_none(self):
        self.assertIsNone(read_access_token("C:\\definitely\\missing.json"))
        self.assertIsNone(read_access_token(""))

    def test_valid_token_is_returned(self):
        path = self._write(
            {"access_token": "abc", "expires_at": 1_900_000_000_000}
        )
        self.assertEqual(read_access_token(path), "abc")

    def test_expired_token_is_skipped_without_refresh(self):
        path = self._write({"access_token": "abc", "expires_at": 1_000_000})
        self.assertIsNone(read_access_token(path))

    def test_garbage_file_returns_none(self):
        handle = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8")
        handle.write("not json")
        handle.close()
        self.addCleanup(lambda: Path(handle.name).unlink(missing_ok=True))
        self.assertIsNone(read_access_token(handle.name))


class TestSummarizeAccounts(unittest.TestCase):
    def test_counts_and_freshness(self):
        summary = summarize_accounts(LEDGER_ACCOUNT_PAYLOAD)
        self.assertEqual(summary["account_count"], 2)
        self.assertEqual(summary["latest_sync"], "2026-11-27 13:54:15")
        self.assertEqual(summary["scope"], [])

    def test_scope_matches_ids_and_names(self):
        summary = summarize_accounts(
            LEDGER_ACCOUNT_PAYLOAD, ["193885689", "手工基金", "missing-account"]
        )
        self.assertEqual(summary["scope_matched"], ["193885689", "手工基金"])
        self.assertEqual(summary["scope_unknown"], ["missing-account"])

    def test_unknown_payload_shape_is_tolerated(self):
        summary = summarize_accounts({"weird": "not-a-list"})
        self.assertEqual(summary["account_count"], 0)
        self.assertEqual(summarize_accounts(None)["account_count"], 0)


class TestSyncPlan(unittest.TestCase):
    def tearDown(self):
        Config.reset_instance()

    def test_nothing_configured_keeps_the_hook_disabled(self):
        with patch.dict(os.environ, {"STOCK_LIST": "600519"}, clear=True):
            Config.reset_instance()
            self.assertIsNone(portfolio_sync_command._resolve_plan())
            self.assertFalse(portfolio_sync_command.schedule_portfolio_sync())

    def test_explicit_portfolio_command_wins(self):
        with patch.dict(
            os.environ,
            {
                "STOCK_LIST": "600519",
                "PORTFOLIO_SYNC_COMMAND": "py -3 wrapper.py",
                "TZZB_SYNC_ENABLED": "true",
                "TZZB_SYNC_COMMAND": "py -3 bridge.py",
            },
            clear=True,
        ):
            Config.reset_instance()
            plan = portfolio_sync_command._resolve_plan()
        self.assertIsNotNone(plan)
        self.assertEqual(plan["source"], "PORTFOLIO_SYNC_COMMAND")
        self.assertEqual(plan["command"], "py -3 wrapper.py")
        self.assertIsNone(plan["preflight"])

    def test_ledger_settings_drive_the_hook_when_no_command(self):
        with patch.dict(
            os.environ,
            {
                "STOCK_LIST": "600519",
                "TZZB_SYNC_ENABLED": "true",
                "TZZB_SYNC_COMMAND": "py -3 bridge.py",
                "TZZB_MCP_ENDPOINT": "https://ledger.example/mcp",
                "TZZB_SYNC_ACCOUNTS": "193885689",
                "TZZB_SYNC_MIN_INTERVAL_SECONDS": "120",
                "TZZB_SYNC_TIMEOUT_SECONDS": "45",
            },
            clear=True,
        ):
            Config.reset_instance()
            plan = portfolio_sync_command._resolve_plan()
        self.assertEqual(plan["source"], "TZZB")
        self.assertEqual(plan["command"], "py -3 bridge.py")
        self.assertEqual(plan["env_extra"][ACCOUNTS_ENV], "193885689")
        self.assertEqual(plan["interval_seconds"], 120.0)
        self.assertEqual(plan["timeout_seconds"], 45.0)
        self.assertIsNotNone(plan["preflight"])

    def test_read_only_probe_runs_without_a_command(self):
        with patch.dict(
            os.environ,
            {
                "STOCK_LIST": "600519",
                "TZZB_SYNC_ENABLED": "true",
                "TZZB_MCP_ENDPOINT": "https://ledger.example/mcp",
                "TZZB_MCP_AUTH_FILE": "C:\\tools\\token.json",
            },
            clear=True,
        ):
            Config.reset_instance()
            plan = portfolio_sync_command._resolve_plan()
        self.assertEqual(plan["command"], "")
        self.assertIsNotNone(plan["preflight"])

    def test_preflight_failure_is_swallowed(self):
        def boom():
            raise RuntimeError("ledger down")

        portfolio_sync_command._run_preflight(boom)  # must not raise
        portfolio_sync_command._run_preflight(None)


if __name__ == "__main__":
    unittest.main()
