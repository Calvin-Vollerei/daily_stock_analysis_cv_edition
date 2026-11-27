#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""中性示例：如何给持仓里「没有实时行情」的品种补一条价格。

用途
----
桌面端的持仓估值只看 `stock_daily.close`（`price_source=history_close`）。银行理财、
黄金类持仓、场外基金净值这类品种没有行情源，必须由外部脚本按「品种代码 + 日期」写进
`stock_daily`。本文件是**可运行的最小样例**，演示一份合规的同步脚本需要满足的契约：

  1. 数据库路径从 `--db` 或环境变量 `DSA_DB_PATH` 读，**不要写死**；
  2. 品种代码用 `EXAMPLE_` 之类的中性前缀，盘面代码只允许 A 股/港股/美股等真实代码；
  3. 落库日期用**数据源自带的日期**，不要硬套「今天」；
  4. `(code, date)` 唯一，先 UPDATE 后 INSERT，重复跑不产生重复行；
  5. 拉取/校验失败时直接退出非 0，**不写 0、不动库**；
  6. 支持 `--dry-run` 只打印不写库。

真实的银行/渠道同步脚本带有个人账户信息，属于**本机私有资产**，不要提交进仓库，
也不要打进安装包（见 `docs/desktop-sidecars.md`）。

用法
----
    python example-sync-job.py --dry-run
    python example-sync-job.py --db <path>
    DSA_DB_PATH=<path> python example-sync-job.py

桌面端的启动钩子 `PORTFOLIO_SYNC_COMMAND` 可以串起多个这样的脚本，例如：

    PORTFOLIO_SYNC_COMMAND=py -3 "<安装目录>\\resources\\desktop-sidecars\\example-sync-job.py"
"""

from __future__ import annotations

import argparse
import os
import sqlite3
import sys
from datetime import date
from pathlib import Path
from typing import List, Tuple

#: 示例品种代码。中性前缀 + 数字，避免与任何真实产品代码混淆。
EXAMPLE_SYMBOL = "EXAMPLE_NAV_01"
#: 数据源标记，写进 stock_daily.data_source，便于筛选/回滚。
DATA_SOURCE = "example-sync-job"
#: 应用根 = 本文件上三级目录（仓库的 scripts/desktop-sidecars-example/ 或安装包 resources/）；
#: 两种布局下都能推出 <应用根>/data/stock_analysis.db。
APP_ROOT = Path(__file__).resolve().parents[2]


def resolve_db(cli_value: str | None) -> Path:
    """--db > DSA_DB_PATH > <应用根>/data/stock_analysis.db。"""
    if cli_value:
        return Path(cli_value).expanduser()
    from_env = (os.environ.get("DSA_DB_PATH") or "").strip()
    if from_env:
        return Path(from_env).expanduser()
    return APP_ROOT / "data" / "stock_analysis.db"


def fetch_navs() -> List[Tuple[str, str, float]]:
    """返回 [(code, date, close), ...]。

    真实脚本在这里拉银行官网 / 渠道接口的净值；示例固定返回一条，便于离线验证链路。
    约定：日期用数据源自己的披露日，不用今天。
    """
    today = date.today().isoformat()
    return [(EXAMPLE_SYMBOL, today, 1.0)]


def main(argv: List[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="example sync job: write one NAV row into stock_daily")
    parser.add_argument("--db", default=None, help="database path (default: DSA_DB_PATH)")
    parser.add_argument("--dry-run", action="store_true", help="print rows without writing")
    args = parser.parse_args(argv)

    db_path = resolve_db(args.db)
    if not db_path.exists():
        print(f"[example-sync] database not found: {db_path}; DSA creates it on first launch", flush=True)
        return 2

    rows = fetch_navs()
    print(f"[example-sync] {len(rows)} row(s), db={db_path}", flush=True)
    for code, day, close in rows:
        print(f"[example-sync]   {code} {day} close={close}", flush=True)
    if args.dry_run:
        print("[example-sync] DRY-RUN, nothing written", flush=True)
        return 0

    connection = sqlite3.connect(str(db_path), timeout=10)
    try:
        connection.execute("PRAGMA busy_timeout = 5000")
        for code, day, close in rows:
            updated = connection.execute(
                "UPDATE stock_daily SET close=?, open=?, high=?, low=?, data_source=?, "
                "updated_at=CURRENT_TIMESTAMP WHERE code=? AND date=?",
                (close, close, close, close, DATA_SOURCE, code, day),
            ).rowcount
            if not updated:
                connection.execute(
                    "INSERT INTO stock_daily (code, date, open, high, low, close, data_source) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (code, day, close, close, close, close, DATA_SOURCE),
                )
        connection.commit()
    except sqlite3.Error as exc:
        connection.rollback()
        print(f"[example-sync] write failed: {exc}", flush=True)
        return 1
    finally:
        connection.close()

    print("[example-sync] done", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
