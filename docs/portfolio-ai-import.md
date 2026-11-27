# AI 辅助导入持仓 · 操作手册（给 AI 读）

> 面向对象：任意具备 HTTP 调用能力的 AI 助手（Claude / GPT / DeepSeek 等）。
> 本文件由 DSA 桌面版「持仓 → 券商流水 → AI 导入」按钮把路径复制到剪贴板后，由用户粘贴给你。
> 版本：3.35.0-cv-edition-patch1

---

## 0. 一句话任务

把用户手里任何形式的持仓或成交信息（券商导出文件、银行 App 截图、Excel、聊天记录、口头描述），
转换成 DSA 能接受的**交易流水**，通过本地 API 写入，并回报导入了什么、跳过了什么、还缺什么。

**关键前提：DSA 没有"导入持仓表"的接口。** 持仓是由交易流水按成本口径（FIFO 或均价）现算出来的。
你要写的是「买卖流水」，不是「持仓快照」。

---

## 1. 先连上后端

- 桌面版的端口不固定，在 **8000–8100** 之间。依次探测，第一个响应下面的探活接口的就是它：

```bash
curl -s http://127.0.0.1:8000/api/v1/portfolio/accounts
```

- 成功返回形如 `{"accounts":[{"id":1,"name":"A股账户","market":"cn","base_currency":"CNY",...}]}`。
- 所有接口都在 `/api/v1/portfolio` 前缀下。
- 本地默认无鉴权（未开启 `ADMIN_AUTH_ENABLED`）；若返回 401，请让用户先在 Web 界面登录。
- **不要**试图重启应用或改端口；端口探测失败就停下来问用户应用是否在运行。

---

## 2. 数据模型

| 实体 | 端点 | 作用 |
| --- | --- | --- |
| 账户 | `GET/POST /accounts`、`PUT/DELETE /accounts/{id}` | 所有流水都必须归属某个账户 |
| 交易流水 | `GET/POST /trades`、`DELETE /trades/{id}` | 买卖记录，**持仓的唯一来源** |
| 资金流水 | `GET/POST /cash-ledger`、`DELETE /cash-ledger/{id}` | 出入金，决定页面上的「总现金」 |
| 公司行为 | `GET/POST /corporate-actions`、`DELETE /corporate-actions/{id}` | 现金分红、拆并股调整 |
| 快照 | `GET /snapshot` | 派生结果：持仓数量、成本、市值、盈亏 |
| 风险 | `GET /risk` | 集中度、行业分布、回撤、止损 |
| 券商文件解析 | `POST /imports/csv/parse`、`POST /imports/csv/commit`、`GET /imports/csv/brokers` | 内置华泰/中信/招商三家解析器 |

---

## 3. 代码（symbol）格式 —— 必须匹配，否则行情查不到

| 品种 | 格式 | 示例 |
| --- | --- | --- |
| A股 / ETF / 场内基金 | 6 位数字，可带 `SH`/`SZ`/`BJ` 前缀 | `600519`、`510300`、`SH600519` |
| 港股 | 5 位数字，可带 `HK` 前缀 | `00700`、`HK00700` |
| 美股 | 大写字母 + 可选 `.`/`-` | `AAPL`、`MSFT`、`BRK.B` |
| 日股 | 代码 + `.T` | `7203.T` |
| 韩股 | 代码 + `.KS` 或 `.KQ` | `005930.KS` |
| 台股 | 代码 + `.TW` 或 `.TWO` | `2330.TW` |
| 场外基金 | 6 位数字 | `019305`、`011062` |
| 黄金积存 | `GOLD_` 前缀 | `GOLD_ICBC` |
| 银行理财 | `WMP_` 前缀 | `WMP_HZ2401`、`WMP_23713A` |

**行情可得性**：A股/港股/美股/日股/韩股/台股有实时行情；场外基金只能拿到日线净值；
`GOLD_*` 与 `WMP_*` 由外部同步脚本定价，实时行情链对它们永远失败——所以写入后它们在页面上
显示「未刷新」是正常现象，不要反复重试。

---

## 4. 请求体字段

### 4.1 交易（`POST /trades`）

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `account_id` | int | ✅ | 必须已存在 |
| `symbol` | string(1–16) | ✅ | 见第 3 节格式 |
| `trade_date` | `YYYY-MM-DD` | ✅ | 成交日 |
| `side` | `buy` / `sell` | ✅ | |
| `quantity` | number > 0 | ✅ | 股数 / 份额 |
| `price` | number > 0 | ✅ | 成交价 |
| `fee` | number ≥ 0 | | 手续费，默认 0 |
| `tax` | number ≥ 0 | | 税费，默认 0 |
| `market` | `cn`/`hk`/`us`/`jp`/`kr`/`tw` | | 不填则用账户市场 |
| `currency` | string(3–8) | | 不填则用账户基准币种 |
| `trade_uid` | string(1–128) | | **强烈建议填**，用于幂等去重（见第 6 节） |
| `note` | string(1–255) | | 备注 |

```bash
curl -s -X POST http://127.0.0.1:8000/api/v1/portfolio/trades \
  -H 'Content-Type: application/json' \
  -d '{"account_id":1,"symbol":"600519","trade_date":"2026-11-20","side":"buy",
       "quantity":100,"price":1450.5,"fee":5,"tax":0,"trade_uid":"ht-20261120-0001"}'
```

返回 `{"id": 123}`。

### 4.2 资金流水（`POST /cash-ledger`）

`account_id`、`event_date`、`direction`（`in`/`out`）、`amount`(>0)、`currency`、`note`。

### 4.3 公司行为（`POST /corporate-actions`）

`account_id`、`symbol`、`effective_date`、`action_type`（`cash_dividend`/`split_adjustment`）、
`cash_dividend_per_share`（现金分红时填，每股金额）、`split_ratio`（拆并股时填，>0）。

### 4.4 账户（`POST /accounts`）

`name`（必填）、`market`（默认 `cn`）、`base_currency`（默认 `CNY`）、`broker`、`owner_id`。

---

## 5. 推荐工作流（严格按顺序）

```text
1. GET  /accounts                    → 有账户就用，没有就 POST /accounts 建一个
2. GET  /trades?page=1&page_size=200 → 拉已有流水，作为去重基线
3. 逐笔 POST /trades                 → 每笔都带 trade_uid
4. POST /cash-ledger                 → 有出入金就记
5. POST /corporate-actions           → 有分红/拆并股就记
6. GET  /snapshot                    → 校验：持仓数量、成本、市值是否符合用户预期
7. 输出报告                           → 导入了多少笔 / 跳过多少重复 / 哪些没识别出来
```

第 6 步必须做。`GET /snapshot` 会返回每个持仓的 `quantity`、`avgCost`、`marketValueBase`、
`unrealizedPnlBase`、`priceSource`。把用户告诉你的持仓数量与它逐条核对，不一致就停下来报告差异，
不要自行猜测修正。

---

## 6. 去重与幂等

- 带 `trade_uid` 时，后端会检查同账户下是否已存在同一 `trade_uid`，**命中则跳过写入**。
- `trade_uid` 请构造得稳定且可复现，例如 `"{来源}-{日期}-{序号}"`：`huatai-20261120-0001`。
- 不带 `trade_uid` 时**完全没有去重**——同一批数据导两次，持仓就翻倍。
- 第 2 步拉取已有流水时，按 `(symbol, trade_date, side, quantity, price)` 做一次人工比对，
  能进一步避免重复。

---

## 7. 硬约束（违反会破坏用户数据）

1. **不要**直接读写 `data/stock_analysis.db`（SQLite）。所有写入只能走上面的 HTTP 接口。
2. **不要**调用 `DELETE /accounts/{id}`：它会连同该账户下的所有流水一起清除。
3. **不要**重启、关闭或重新安装应用；也不要改端口、改 `.env`。
4. **不要**为了"修正"而批量删除流水，除非用户明确确认要删哪几条。
5. 卖出数量超过当前持仓时后端会拒绝（`InsufficientPositionError`）。遇到这个错误，
   先按时间顺序补齐更早的买入流水，再重试卖出，不要改成"少卖一点"糊弄过去。
6. 数量必须 `> 0`，价格必须 `> 0`，日期必须是 `YYYY-MM-DD`。
7. 人民币以外的品种，务必让 `currency` 与账户 `base_currency` 的折算关系说得通；
   拿不准就显式传 `currency`。

---

## 8. 常见错误对照

| 返回 | 含义 | 处理 |
| --- | --- | --- |
| `422` | 字段类型或范围不合法 | 看 `detail` 里的字段名，修好再发 |
| `404` | `account_id` 或路径不存在 | 先 `GET /accounts` 确认真实 id |
| `409` / `400` | 业务校验失败（如卖出超仓） | 按第 7 节第 5 条补齐买入流水 |
| `401` | 开启了鉴权 | 让用户在 Web 界面登录后重试 |
| 连接失败 | 后端没起或端口不对 | 让用户确认应用已启动，再探测 8000–8100 |

---

## 9. 交付报告模板

```markdown
## 导入结果
- 目标账户：#<id> <name>（市场 <market>，基准币种 <currency>）
- 新增交易：<n> 笔（买入 <a> / 卖出 <b>）
- 跳过重复：<n> 笔（依据 trade_uid）
- 新增资金流水：<n> 笔；公司行为：<n> 笔
- 未识别 / 需用户确认：<列出原始条目与原因>

## 快照校验
| 标的 | 录入后数量 | 用户期望 | 一致 |
| --- | --- | --- | --- |
| 600519 | 100 | 100 | ✅ |

## 遗留问题
- <例如：某笔分红的每股金额原文缺失，未写入>
```

---

## 10. 自检清单（提交前逐条确认）

- [ ] 每笔交易都有 `account_id`、合法 `symbol`、`YYYY-MM-DD` 日期、正数数量与价格
- [ ] 每笔交易都带了稳定可复现的 `trade_uid`
- [ ] 已用 `GET /trades` 做过基线比对，没有重复写入
- [ ] 卖出流水有对应的买入流水支撑
- [ ] `GET /snapshot` 的数量与用户预期逐条核对过
- [ ] 没有直接碰数据库文件，没有删除账户
- [ ] 报告里写清了「导入 / 跳过 / 待确认」三类结果
