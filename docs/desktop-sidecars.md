# 桌面端 Sidecar 脚本（持仓与净值同步）

本文说明桌面端「没有实时行情的持仓」怎么补价格：机制是什么、安装包里有什么、个人脚本怎么放、
以及一份合规同步脚本必须满足的契约。

## 为什么需要它

旧架构由开机自启的 `DSA启动器`（`dsa-launcher.py`）在 DSA 之前依次跑若干同步脚本，把银行理财、
黄金类持仓、场外基金的净值写进数据库。新架构（Electron 壳 + PyInstaller 后端）没有启动器，后果是：

- 交易所品种（A 股/港股/美股、ETF、场内基金）由后端自己的实时行情链路刷新，仍在更新；
- **银行理财、黄金类持仓、场外基金净值没有任何行情源**，只能靠外部脚本写入 `stock_daily`，
  没人跑就冻结在最后一次落库日 —— 持仓估值随之停在旧价格。

所以需要的不是一个常驻守护进程，而是**一个「应用打开时跑一次本机同步脚本」的钩子**。

## 触发链

```
Electron main.js
  └─ startBackend() 注入 ENV_FILE / DATABASE_PATH / LOG_DIR / WEBUI_PORT
       └─ FastAPI startup 钩子 src/services/portfolio_sync_command.py
            ├─ PORTFOLIO_SYNC_COMMAND 非空 → 注入 DSA_DB_PATH，daemon 线程跑一次
            └─ 为空且开启了账本同步 → src/services/tzzb_sync.py 组织同一条钩子
                 ├─（可选）只读 MCP 账户校验（账户数 / 最近同步时间 / 账户范围）
                 └─（可选）用户自己的账本桥接命令（唯一写库路径）
                      └─ 按 (代码, 日期) 写入 stock_daily
```

要点：

- 触发点在**后端就绪之后**，不阻塞首屏；同步脚本崩了/超时也只写日志，接口与页面不受影响；
- `portfolio_sync_command.py` 自带去重窗口（`PORTFOLIO_SYNC_MIN_INTERVAL_SECONDS`，默认 6 小时），
  反复开关应用不会反复爬银行；
- 钩子是通用能力，不绑定任何具体渠道；多脚本串联由用户自己决定（见下文的 wrapper 写法）；
- `PORTFOLIO_SYNC_COMMAND` 与服务端账本（TZZB）配置**互斥且后者优先级更低**：写了命令就用命令，
  没写才看账本开关。

## 安装包里带什么、不带什么

| 内容 | 是否进仓库 | 是否进安装包 |
| --- | --- | --- |
| `scripts/desktop-sidecars-example/example-sync-job.py`（中性模板，`EXAMPLE_*` 占位） | 是 | 是 → `<安装目录>\resources\desktop-sidecars\example-sync-job.py` |
| 本文档 | 是 | 否（随仓库发布） |
| 真实渠道同步脚本（银行/券商/账本导入，含个人账户名、产品码、本机令牌路径） | **否**（`.gitignore` 忽略 `scripts/desktop-sidecars/`） | **否** |

`apps/dsa-desktop/package.json` 中登记的 `extraResources` 条目只指向中性模板目录：

```json
{
  "from": "../../scripts/desktop-sidecars-example",
  "to": "desktop-sidecars"
}
```

> 安装包里的 `resources\desktop-sidecars\` 是给用户放自己脚本的位置，出厂时只有模板，
> 不含任何个人数据。打包前请用 `git status --short` 与 grep 确认该目录没有个人脚本混入。

## 启用方法

在桌面端安装目录的 `.env` 中加一行（把路径换成实际安装位置）：

```ini
PORTFOLIO_SYNC_COMMAND=py -3 "<安装目录>\resources\desktop-sidecars\example-sync-job.py"
```

> 这一行只是用来验证「钩子链路是否通」：它会往 `stock_daily` 写一条 `EXAMPLE_NAV_01` 示例行
> （可按 `data_source='example-sync-job'` 删掉）。正式使用时换成自己的脚本或下面的 wrapper。

写入要点（已实测）：

- 值**不要以引号开头**：`python-dotenv` 会把整行当引号字符串解析，实测得到 `None`，命令直接失效；
- 解释器写 `py -3` 或 `python`（都在 PATH 时均可），**只给路径加引号**，因为安装目录通常含空格；
- 解释器自身路径若含空格（用户名带空格等），用 `py -3` 规避；
- 保存后重启应用生效，`<安装目录>\logs\desktop.log` 里会有 `[portfolio sync]` 前缀的日志。

多个脚本按顺序串起来时，用一个小 wrapper（纯本地文件，勿提交）：

```python
# <本机私有目录>\my-sidecars.py
import subprocess, sys
from pathlib import Path

here = Path(__file__).resolve().parent
for name in ("sync-a.py", "sync-b.py", "sync-c.py"):
    script = here / name
    if not script.exists():
        continue
    # 单个脚本失败不影响后续；整体退出码只作日志参考
    subprocess.run([sys.executable, str(script)], check=False)
```

```ini
PORTFOLIO_SYNC_COMMAND=py -3 "<本机私有目录>\my-sidecars.py"
```

## 同步脚本契约

一份能被这个钩子安全调用的脚本必须满足以下约定（`example-sync-job.py` 是完整可运行样例）：

1. **库路径从外部读**：`--db` 参数优先，其次环境变量 `DSA_DB_PATH`（钩子会注入），
   最后按「本文件上三级目录 = 应用根」推导 `<应用根>/data/stock_analysis.db`。
   不允许写死盘符或用户目录。
2. **品种代码不撞真实代码**：没有交易所行情的品种用 `EXAMPLE_` / 自定义前缀的伪代码；
   真实盘面代码只用于真实证券。
3. **日期用数据源自己的披露日**：理财净值普遍 T+1~T+2 披露，把「今天」当净值日会写入错误价格。
4. **幂等**：`stock_daily` 在 `(code, date)` 上唯一，先 `UPDATE` 后 `INSERT`（或
   `ON CONFLICT DO UPDATE`），重复运行不产生重复行。
5. **失败即退出，不写 0**：拉取/校验失败返回非 0 且不改库，避免把持仓估成 0。
6. **支持 `--dry-run`**：只打印将要写入的行，便于人工核对。
7. **不打印敏感信息**：日志里不要输出账号、令牌、完整持仓金额。

字段落法（`stock_daily`）：`code` = 品种代码，`date` = 净值日/价格日，
`close` = 单位净值或单价，`open/high/low` 同 `close`（沿用库内既有约定），
`data_source` = 脚本标识，便于按来源筛选与回滚。

## 接入同花顺投资账本（TZZB / 账本精灵）

同花顺投资账本（TZZB）是「银行理财 + 黄金 + 场外基金」这些没有行情源的持仓的上游。
DSA 把它当成**可选的投资组合数据源**，配置入口在 **设置 → 数据源**（`TZZB_*`，默认全部关闭），
写入 `.env` 后由启动钩子消费：

| 配置项 | 默认 | 作用 |
| --- | --- | --- |
| `TZZB_SYNC_ENABLED` | `false` | 总开关。关闭时启动链路与未加该配置完全一致 |
| `TZZB_SYNC_COMMAND` | 空 | 接入方式 A：桥接命令（唯一写库路径，例如 `py -3 "<目录>\tzzb-to-dsa.py"`） |
| `TZZB_MCP_ENDPOINT` | 空 | 接入方式 B：账本 MCP JSON-RPC 端点，后端自己做只读账户校验 |
| `TZZB_MCP_AUTH_FILE` | 空 | 接入方式 B 的授权文件（`access_token` + `expires_at`，毫秒） |
| `TZZB_SYNC_ACCOUNTS` | 空（全部） | 需要同步/校验的账户 ID 或名称，逗号分隔 |
| `TZZB_SYNC_MIN_INTERVAL_SECONDS` | `21600` | 去重窗口；`0` = 每次启动都同步 |
| `TZZB_SYNC_TIMEOUT_SECONDS` | `900` | 命令硬超时 |

行为约定（这些是"不阻塞启动"的实现口径）：

- 只有 `TZZB_SYNC_ENABLED=true` 且至少配置了一种接入方式才会跑；否则钩子保持关闭；
- **只读校验**（`TZZB_MCP_ENDPOINT`）由后端自己发起：调用账本 `promptAccountSelection`，
  日志记录账户数量、最近同步时间、以及 `TZZB_SYNC_ACCOUNTS` 里对不上号的条目；
  只读、不写库、**不刷新令牌**（令牌刷新由桥接命令负责，后端不会改写用户的令牌文件）；
- **写库**只由 `TZZB_SYNC_COMMAND` 完成，命令额外收到三个环境变量
  `TZZB_SYNC_ACCOUNTS` / `TZZB_MCP_ENDPOINT` / `TZZB_MCP_AUTH_FILE`（空值不注入），
  脚本因此不必把这些值再写死一份；
- 任何失败（文件缺失、令牌过期、端点不可达、命令 rc!=0、超时）都只写日志，**不阻塞启动、不影响接口**；
- 设置在**下次启动应用**生效；若同时设置了 `PORTFOLIO_SYNC_COMMAND`，则以它为准（通常它已包含账本脚本）。

最小可用配置（只读校验 + 现有私有桥接脚本）：

```ini
TZZB_SYNC_ENABLED=true
TZZB_SYNC_COMMAND=py -3 "<本机私有目录>\tzzb-to-dsa.py"
TZZB_MCP_ENDPOINT=https://tzzb.10jqka.com.cn/mcp
TZZB_MCP_AUTH_FILE=C:\Users\<user>\.dsh-tzzb\token.json
TZZB_SYNC_ACCOUNTS=193885689
```

排障：

```powershell
# 启动后应能看到账本相关日志（--dry-run 的桥接命令同样可用）
Select-String -Path "<安装目录>\logs\desktop.log" -Pattern "portfolio sync|\[tzzb\]"
```

## 手动验证

```powershell
# 1) 模板能否跑通（只打印，不写库）
py -3 "<安装目录>\resources\desktop-sidecars\example-sync-job.py" --dry-run

# 2) 指定库文件再跑一次
py -3 scripts\desktop-sidecars-example\example-sync-job.py --dry-run --db "<应用根>\data\stock_analysis.db"

# 3) 在源码仓库里核对来源与行数
python -c "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); print(c.execute(\"select code,date,close,data_source from stock_daily where data_source='example-sync-job' order by date desc limit 5\").fetchall())" "<应用根>\data\stock_analysis.db"

# 4) 确认钩子确实被调到（重启应用后看日志）
Select-String -Path "<安装目录>\logs\desktop.log" -Pattern "portfolio sync"
```

## 隐私与仓库纪律

- 真实同步脚本里必然出现**具体账户名、产品代码、本机令牌路径**，这三类都属于个人数据，
  因此它们只存在于本机，通过 `.gitignore` 的 `scripts/desktop-sidecars/` 排除；
- 提交前自检（应无输出）：

```bash
git status --short | grep -Ei "sidecars/" || true
grep -rniE "账户|passwd|secret|请填写" scripts/desktop-sidecars-example/ || true
```

- 安装包里只有 `example-sync-job.py` 与本文档描述的机制，不含任何账户、产品码或本机路径。

## 已知缺口（留给后续）

1. **通用命令没有自动注入**：`PORTFOLIO_SYNC_COMMAND` 仍需用户手写。更友好的做法是在
   `apps/dsa-desktop/main.js` 的 `buildBackendEnvironment()`（约 885 行）里，当用户未设置该键、
   且 `resources/desktop-sidecars/` 下有脚本时补一个默认值（只影响进程环境，不改写用户 `.env`）。
   这属于 Electron 侧改动，不需要重打 PyInstaller。
   （账本侧已先行收口：`TZZB_*` 可在 设置 → 数据源 里配置，后端直接消费，见上文。）
2. **持仓穿透的消费端已补齐**：后端已提供 `GET /api/v1/portfolio/lookthrough`，优先取中间层
   （`PORTFOLIO_SECTOR_LAYER_URL`），中间层不可用时回退本地快照 `sector-layer/lookthrough.json`
   （可用 `PORTFOLIO_LOOKTHROUGH_PATH` 覆盖），两者都缺才返回 404 让前端卡片降级。
   详见 [portfolio-risk-exposure-dashboard.md](portfolio-risk-exposure-dashboard.md)。
3. **行业口径依赖外部中间层**：`.env.example` 的 `PORTFOLIO_SECTOR_LAYER_URL` 指向一个本地
   sidecar（用基金季报重算行业集中度）。没有常驻进程时静默回退到后端自算口径。
   长期应收进后端 `src/services/`，同样需要重打后端。

## 相关文档

- 桌面端打包与目录结构：[desktop-package.md](desktop-package.md)
- 持仓实时行情缓存与启动预热：`.env.example` 的 `PORTFOLIO_QUOTE_*`
- 外部同步钩子：`.env.example` 的 `PORTFOLIO_SYNC_*`
