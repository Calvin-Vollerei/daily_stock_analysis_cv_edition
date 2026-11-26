# 面向 AI 的数据接口速查

本文档面向 **AI Agent / 自动化脚本**，用于快速定位「要做某件事，该调哪个接口」。字段级的完整契约请看 `docs/full-guide.md`、`docs/stock-profile-api.md`、`docs/multi-strategy-contract.md`。

---

## 1. 基础约定

| 项 | 值 |
| --- | --- |
| Base URL | `http://<host>:<port>/api/v1`（默认端口 `8000`） |
| 请求 / 响应 | JSON（`Content-Type: application/json`） |
| 认证 | Cookie 会话；`GET /auth/status` 返回是否开启认证 |
| 错误响应 | `{"detail": {"error": "<code>", "message": "<可读说明>", "detail": <可选>}}` |
| 健康检查 | `GET /api/v1/health` → `{"status":"ok","timestamp":"..."}` |

### 认证流程

```
GET  /auth/status            # 判断 auth_enabled
POST /auth/login             # {"password": "..."} → 写入会话 Cookie
POST /auth/logout            # 结束会话
POST /auth/change-password
```

未开启认证时，所有接口可直接调用。

> AI 调用建议：先 `GET /auth/status`；若 `auth_enabled=true` 且未登录，先 `POST /auth/login` 并把返回的 Cookie 带上后续请求。

---

## 2. 端点分组

### 2.1 健康与能力探测

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/health` | 服务存活 |
| GET | `/data/overview` | 数据源总览与可用性 |
| GET | `/data/capabilities` | 当前部署支持哪些数据能力 |
| GET | `/config/schema` | 全部配置项的结构定义 |

### 2.2 行情与个股

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/stocks/watchlist` | 读取自选股列表 |
| POST | `/stocks/watchlist/add` | 添加自选股 |
| POST | `/stocks/watchlist/remove` | 移除自选股 |
| GET | `/stocks/{stock_code}/quote` | 实时报价 |
| GET | `/stocks/{stock_code}/history` | 历史 K 线 |
| GET | `/stocks/{stock_code}/profile` | 个股概况 |
| POST | `/stocks/extract-from-image` | 从截图里识别股票代码 |
| POST | `/stocks/parse-import` | 解析批量导入文本 |

### 2.3 分析与复盘

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| POST | `/analysis/analyze` | 发起个股分析任务 |
| POST | `/analysis/market-review` | 发起大盘复盘 |
| GET | `/analysis/tasks` | 任务列表 |
| GET | `/analysis/tasks/stream` | 任务事件流 |
| GET | `/analysis/status/{task_id}` | 任务状态 |
| GET | `/analysis/tasks/{task_id}/flow` | 任务执行流程 |

### 2.4 历史记录与报告

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/history/stocks` | 有历史记录的股票列表 |
| GET | `/history/{record_id}` | 单条分析记录 |
| GET | `/history/{record_id}/markdown` | 完整报告（Markdown） |
| GET | `/history/{record_id}/news` | 该次分析关联的新闻 |
| GET | `/history/{record_id}/diagnostics` | 诊断信息 |
| GET | `/history/{record_id}/share-image` | 分享图（PNG） |
| DELETE | `/history/by-code/{stock_code}` | 按代码清空历史 |

### 2.5 决策信号

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/decision_signals/latest/{stock_code}` | 最新信号 |
| GET | `/decision_signals/{signal_id}` | 单条信号详情 |
| GET | `/decision_signals/{signal_id}/outcomes` | 信号结果追踪 |
| GET | `/decision_signals/outcomes` | 结果列表 |
| GET | `/decision_signals/outcomes/stats` | 命中率等统计 |
| GET | `/decision_signals/stocks/{stock_code}/review` | 个股复盘 |
| POST | `/decision_signals/reassess` | 重新评估（返回预览） |
| PATCH | `/decision_signals/{signal_id}/status` | 更新信号状态 |
| GET/PUT | `/decision_signals/{signal_id}/feedback` | 读取 / 写入反馈 |

### 2.6 选股与筛选

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/screening/status` | 筛选服务状态 |
| GET | `/screening/strategies` | 可用策略 |
| GET | `/screening/hotspots` | 热门题材 |
| POST | `/screening/screen/check` | 预检（不执行） |
| POST | `/screening/screen/tasks` | 异步发起筛选（202） |
| GET | `/screening/screen/tasks/{task_id}` | 异步任务状态 |
| POST | `/screening/screen` | 同步筛选 |
| GET | `/screening/history` | 历史筛选结果 |

### 2.7 持仓与组合

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET/POST | `/portfolio/accounts` | 账户列表 / 新建账户 |
| PUT/DELETE | `/portfolio/accounts/{account_id}` | 更新 / 删除账户 |
| GET/POST | `/portfolio/trades` | 交易流水 |
| GET/POST | `/portfolio/cash-ledger` | 资金流水 |
| GET/POST | `/portfolio/corporate-actions` | 公司行为 |
| GET | `/portfolio/snapshot` | 组合快照（持仓 + 市值 + 现金） |
| GET | `/portfolio/risk` | 风险与暴露看板 |
| POST | `/portfolio/positions/{symbol}/analysis` | 单只持仓分析 |
| POST | `/portfolio/imports/csv/parse` | 券商 CSV 解析 |
| GET | `/portfolio/imports/csv/brokers` | 支持的券商列表 |
| POST | `/portfolio/imports/csv/commit` | 提交导入结果 |
| POST | `/portfolio/fx/refresh` | 刷新汇率 |

### 2.8 情报源

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET/POST | `/intelligence/sources` | 情报源列表 / 新建 |
| GET | `/intelligence/sources/templates` | 内置模板 |
| POST | `/intelligence/sources/{source_id}/fetch` | 抓取单个源 |
| POST | `/intelligence/sources/fetch-enabled` | 抓取所有启用的源 |
| GET | `/intelligence/items` | 已入库的情报条目 |

### 2.9 提醒与通知

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET/POST | `/alerts/rules` | 提醒规则列表 / 新建 |
| PATCH/DELETE | `/alerts/rules/{rule_id}` | 修改 / 删除规则 |
| POST | `/alerts/rules/{rule_id}/enable` | 启用 |
| POST | `/alerts/rules/{rule_id}/disable` | 停用 |
| POST | `/alerts/rules/{rule_id}/test` | 测试触发 |
| GET | `/alerts/triggers` | 触发历史 |
| GET | `/alerts/notifications` | 通知投递记录 |

### 2.10 回测

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| POST | `/backtest/run` | 发起回测 |
| GET | `/backtest/results` | 回测结果 |
| GET | `/backtest/performance` | 整体绩效 |
| GET | `/backtest/performance/{code}` | 单只标的绩效 |

### 2.11 系统配置与调度

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/config` | 读取配置（敏感项已脱敏） |
| PUT | `/config` | 写入配置 |
| GET | `/config/setup/status` | 首次运行自检 |
| POST | `/config/validate` | 校验待写入配置 |
| GET | `/config/export` | 导出配置 |
| POST | `/config/import` | 导入配置 |
| GET | `/config/scheduler/status` | 定时任务状态 |
| POST | `/config/scheduler/run-now` | 立即执行一次 |
| POST | `/config/llm/test-channel` | 测试模型渠道 |
| POST | `/config/notification/test-channel` | 测试通知渠道 |
| POST | `/config/llm/discover-models` | 发现可用模型 |

### 2.12 Agent 对话

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| POST | `/agent/chat` | 非流式对话 |
| POST | `/agent/chat/stream` | 流式对话（SSE） |
| POST | `/agent/chat/send` | 发送消息 |
| GET | `/agent/chat/sessions` | 会话列表 |
| GET | `/agent/chat/sessions/{session_id}` | 会话消息 |
| DELETE | `/agent/chat/sessions/{session_id}` | 删除会话 |
| GET | `/agent/models` | 可用模型 |
| GET | `/agent/status` | Agent 后端状态 |
| POST | `/agent/research` | 发起研究任务 |

### 2.13 用量统计

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/usage/summary` | 模型用量汇总 |
| GET | `/usage/dashboard` | 用量面板 |

---

## 3. 典型调用示例

### 3.1 读取组合快照

```bash
curl -s http://127.0.0.1:8000/api/v1/portfolio/snapshot
```

### 3.2 发起一次个股分析

```bash
curl -s -X POST http://127.0.0.1:8000/api/v1/analysis/analyze \
  -H "Content-Type: application/json" \
  -d '{"stock_codes": ["600519", "000001"]}'
```

拿到 `task_id` 后轮询：

```bash
curl -s http://127.0.0.1:8000/api/v1/analysis/status/<task_id>
```

### 3.3 取完整报告

```bash
curl -s http://127.0.0.1:8000/api/v1/history/<record_id>/markdown
```

### 3.4 读风险看板

```bash
curl -s http://127.0.0.1:8000/api/v1/portfolio/risk
```

---

## 4. 推荐调用顺序

AI 端处理「看看我的持仓怎么样」这类任务时，建议按下列顺序：

```
1. GET  /health                       → 确认服务在线
2. GET  /portfolio/snapshot           → 拿持仓与市值
3. GET  /portfolio/risk               → 拿集中度 / 回撤 / 风险信号
4. GET  /decision_signals/outcomes/stats → 拿历史命中率，判断可信度
5. POST /analysis/analyze             → 需要新增分析时发起任务
6. GET  /analysis/status/{task_id}    → 轮询直到完成
7. GET  /history/{record_id}/markdown → 取回完整报告
```

## 5. 调用注意事项

- **敏感配置已被服务端脱敏**：`GET /config` 返回的密钥字段是掩码，不要据此判断真实值。
- **写操作请先 validate**：批量改配置前先 `POST /config/validate`，避免写坏。
- **异步任务要轮询**：`/screening/screen/tasks`（202）与 `/analysis/analyze` 都返回任务 id，不轮询拿不到结果。
- **不要并发打爆定时任务**：`POST /config/scheduler/run-now` 会与已排队的分析抢占执行槽位，建议串行调用。
- **时间字段是 ISO 8601 字符串**，时区以服务端配置为准。
