# Bing Auto · 自动复盘版（GitHub Actions 驱动）

> 爱在冰川短线情绪周期框架 · 每日两次自动更新（12:00 盘中快照 + 16:00 收盘正式）· 支持追溯补跑

**在线访问**：`https://keyue0.github.io/auto/`

## 自动更新机制

| 时段 | 时间（北京时间） | 行为 | 产物 |
|---|---|---|---|
| **am 盘中** | 每天 12:00 | 拉取盘中实时数据，生成盘中快照 | `data/reviews/<日期>_am.json`（存档，前端默认不展示） |
| **pm 收盘** | 每天 16:00 | 拉取收盘定型数据，生成正式全套 | `data/reviews/<日期>.json` + sentiment/fund/ladders/pools/lhb（前端展示） |

- 仅交易日（周一~周五）触发；非交易日自动跳过（脚本会回溯最近交易日）
- **每次运行都自动追溯最近 1 个交易日**（`--lookback=1`）：即使某天漏跑，第二天 12:00/16:00 会自动补上前一天
- GitHub Actions 云端运行，**与本机无关，电脑关机照常更新**

## 追溯补跑

### 方式一：自动追溯（推荐，每天自动）
- workflow 内置 `--lookback=1`：每次跑"昨天 + 今天"两天
- 想要更多追溯：GitHub Actions 手动触发时填 `lookback=3` → 补最近 4 个交易日

### 方式二：手动触发
1. 打开仓库 GitHub 网页 → **Actions** 标签
2. 左侧选 **"Bing Auto · 每日双定时更新"** → 右侧 **Run workflow**
3. 填写：
   - `slot`：`am`=盘中快照 / `pm`=收盘正式（默认 pm）
   - `lookback`：追溯最近 N+1 个交易日（默认 1）
   - `date`：指定交易日 `YYYY-MM-DD`（留空自动取最近交易日）
4. 点绿色 **Run workflow**，约 30 秒后完成

**追溯"一天的两次记录"示例**：
```bash
node scripts/fetch_data.js --date=2026-08-20 --slot=am   # 该日盘中快照 → 2026-08-20_am.json
node scripts/fetch_data.js --date=2026-08-20 --slot=pm   # 该日收盘正式 → 2026-08-20.json
node scripts/fetch_data.js --slot=pm --lookback=1        # 昨天+今天 收盘正式（自动补漏）
```

## 本地手动运行

```bash
cd auto
node scripts/fetch_data.js                              # 收盘正式（自动取最近交易日）
node scripts/fetch_data.js --slot=am                    # 盘中快照
node scripts/fetch_data.js --slot=pm --lookback=2       # 追溯最近 3 个交易日收盘版
node scripts/fetch_data.js --date=2026-08-20 --slot=am  # 指定某天盘中快照
```

## 数据源（公开免费，无需申请）

| 数据 | 接口 |
|---|---|
| 涨停/跌停/连板池 | 东财 `push2ex.getTopicZTPool / getTopicDTPool` |
| 大盘指数 | 腾讯 `qt.gtimg.cn`（GBK 解码） |
| 涨跌家数 | 东财 `push2delay ulist f104/105/106` |
| 板块资金流 | 东财 `push2delay clist f62`（60 行业板块） |
| 龙虎榜 | 东财 `datacenter RPT_DAILYBILLBOARD_DETAILSNEW` |

## 与精修版（stock-web/）的关系

- `stock-web/`：本地通达信精修版（数据最准、解读最深，人工维护）
- `auto/`：云端自动版（零维护、每天两次，数据为东财口径，略逊于通达信）
- 两者**独立共存，互不影响**；精修版也可覆盖 `auto/data/reviews/<日期>.json` 后推送，自动版优先展示精修内容

## 免责声明

⚠️ 框架化复盘/推演，数据来源东财/腾讯公开行情接口，**不构成投资建议**。盘中快照数据为未定型快照，仅供参考。
