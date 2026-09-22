# Bing · 冰川复盘

爱在冰川短线情绪周期框架复盘 + A股板块资金流向看板。

**在线访问（GitHub Pages）**：https://keyue0.github.io/

> ⚠️ 框架化复盘/推演，数据仅供参考，不构成投资建议。

## 功能模块

| 路由 | 功能 | 说明 |
|---|---|---|
| `#/home` | 首页（Bing） | 最新复盘摘要 + 功能入口 + 数据真实性说明 |
| `#/review` | 冰川复盘 | 九段框架复盘（大盘情绪/板块效应/龙头梯队/主力资金/低位右侧/共振背离/明日计划），支持按日期切换 |
| `#/capital-flow` | 资金流向 | 内嵌参考看板（https://huachangmiao.github.io/stock/），东方财富公开行情接口实时数据 |
| `#/industry` | 行业拥挤度 | 申万二级行业「强势股集中度」监控：KPI + 回避/减配/候选三张清单 + 可排序可筛选全表（数据由 `0914WB/tools/industry_crowding.py` 生成） |
| `#/pool` | 候选池跟踪 | 当日低吸候选池（板块/个股/买点/止损/目标/状态） |
| `#/ladder` | 连板梯队 | 连板梯队结构（2板/3板+ 名单 + 涨停原因） |
| `#/lhb` | 龙虎榜 | 机构净买入 + 游资席位动向 + 拉萨天团 + 盘面小结 |
| `#/sentiment` | 情绪曲线 | 历史情绪档位/涨跌家数/涨停跌停趋势 |
| `#/blogger` | 博主观点 | 外部公众号/博主观点跟踪 |
| `#/trades` | 每日交易记录 | 14字段交易日志 + 统计（胜率/盈亏比/止损率/市场背景×买点交叉/主线偏离）+ LLM 严谨复盘 |

## 目录结构

```
Bing/
├── index.html          主壳（导航 + 内容容器）
├── css/style.css       奶油画布浅色主题样式
├── js/
│   ├── app.js          路由核心 + 工具函数 + 视图注册
│   └── views/
│       ├── home.js     首页视图
│       ├── review.js   冰川复盘视图
│       ├── capital.js  资金流向视图
│       ├── industry.js 行业拥挤度视图
│       ├── pool.js     候选池跟踪
│       ├── ladder.js   连板梯队
│       ├── lhb.js      龙虎榜
│       ├── sentiment.js 情绪曲线
│       ├── blogger.js  博主观点
│       └── trades.js   每日交易记录 + LLM 复盘分析
├── scripts/
│   └── analyze_trades.js  LLM 严谨复盘分析生成（DeepSeek）
├── tools/
│   ├── smoke_view.js  视图渲染冒烟测试（无浏览器，改完视图必跑）
│   └── push_pages.py  同步本目录到 GitHub Pages 仓库并推送
└── data/
    ├── reviews/        复盘数据 JSON
    ├── fund/           资金快照 JSON
    ├── pools/          候选池 JSON
    ├── ladders/        连板梯队 JSON
    ├── lhb/            龙虎榜 JSON
    ├── sentiment.json  情绪曲线累计
    ├── industry_crowding.json  行业拥挤度日报（由 0914WB 的流程写入，勿手改）
    ├── trades/         交易记录 + 分析
    │   ├── trades.json     主交易记录（用户手动维护）
    │   ├── index.json      索引
    │   └── analysis_<日期>.json  LLM 严谨复盘（脚本生成）
    └── views/          博主观点 JSON
```

## 如何新增一个功能页

框架为纯静态 + hash 路由，新增功能只需 3 步：

1. 新建视图：`js/views/xxx.js`，定义对象并注册：
   ```js
   const XxxView = {
     title: '功能名',
     async render(el, params) { el.innerHTML = '...'; }
   };
   App.register('xxx', XxxView);
   ```
2. 在 `index.html` 的 `<nav>` 中添加导航项：`<a href="#/xxx">功能名</a>`
3. 在 `index.html` 底部添加：`<script src="js/views/xxx.js"></script>`

### ★ 新增/改完视图后跑一次冒烟测试

```bash
node tools/smoke_view.js                    # 默认测 industry
node tools/smoke_view.js blogger pool lhb   # 一次测多个
node tools/smoke_view.js blogger capital home industry ladder lhb pool review sentiment trades
```

它用最小 DOM 桩 + **真实的 `js/app.js`** 真实执行一遍 `view.render(el, [])`，
把运行时报错直接打在命令行里。**页面「能打开」不等于视图「能渲染」**：
视图里只要有一个 `ReferenceError`，整个视图白屏，但 HTTP 仍是 200、资源照常返回，
用 curl 完全看不出来。

最容易踩的坑：**跨方法引用局部变量**。在 `render()` 里写
`const helper = a => ...`，然后在 `renderRows()` 里用 `helper` ——
词法作用域取「定义处」，`renderRows` 是对象方法、作用域是模块级，拿不到，直接
`ReferenceError`。辅助函数必须做成视图上的方法（`this.helper`）或模块级 `const`。
`node --check` 只查语法，查不出这类错误。

（`industry.js` 的 `advChip` 就踩过这个坑，由本脚本发现并修复。）

## 如何更新复盘数据

复盘流程（本地）生成报告后，将数据同步到本仓库：

1. `data/reviews/<日期>.json` —— 九段复盘内容（date/weekday/summary/sentiment/limitUp/limitDown/amount/sections）
2. `data/reviews/index.json` —— 复盘索引（按日期降序，最新在前）
3. `data/fund/<日期>.json` —— 当日板块资金快照（rows: name/main(元)/pct）
4. `data/fund/index.json` —— 资金快照索引
5. `data/trades/trades.json` —— 交易记录（**用户手动维护** 14 字段：证券/市场背景/买入时间/买价/买点类型/买入逻辑/是否主线/卖出时间/卖价/卖因/卖点类型/收益率/持股时长/成败归因）
6. `data/trades/index.json` —— 交易记录索引
7. `data/trades/analysis_<日期>.json` —— LLM 严谨复盘（`node scripts/analyze_trades.js` 自动生成，含逐笔 7 维+整体 5 维分析）

然后推送到 `main` 分支，GitHub Pages 自动更新（https://keyue0.github.io/）。

## 每日交易记录表（14 字段）

`data/trades/trades.json` 结构：
```json
{
  "trades": [{
    "id": "T20260821-01",
    "stock": "紫金矿业", "code": "601899", "sector": "有色金属",
    "market_bg": "修复", "market_note": "情绪修复初期",
    "buy_time": "2026-08-21 10:15", "buy_price": 8.52,
    "buy_type": "回踩", "buy_logic": "低位右侧+资金连续流入",
    "is_mainline": true, "mainline_note": "有色金属是主线",
    "sell_time": "2026-08-25 14:30", "sell_price": 9.10,
    "sell_reason": "止盈", "sell_type": "右侧逆转止盈",
    "return_pct": 6.81, "hold_days": 2,
    "result": "成功", "result_reason": "按章作业正反馈",
    "note": "买点回踩5日线，止损未触及"
  }],
  "analysis": null
}
```

**LLM 严谨复盘**（`scripts/analyze_trades.js`，需 `LLM_API_KEY` / `DEEPSEEK_API_KEY` 环境变量）：

- 逐笔 7 维分析：市场背景×买点匹配 / 买入点 / 止损点（结合板块位置） / 卖点类型 / 知行合一 / 成败归因 / 改进建议
- 整体 5 维分析：交易模式 / 时机质量（是否总在不利时机强行交易）/ 主线偏离度 / 止损买入纪律 / 下一步改进清单
- **关键分析维度**：市场背景×买点类型交叉（自动识别"弱势×突破"为体系禁忌）、主线内 vs 非主线胜率、运气 vs 按章作业归因

```bash
# 设置 LLM key（任一即可）
export LLM_API_KEY=sk-...   # 或 DEEPSEEK_API_KEY

# 生成复盘（默认最新交易日期；可用 --date=YYYY-MM-DD 指定）
cd stock-web
node scripts/analyze_trades.js
# → 输出 data/trades/analysis_<日期>.json
```

**前端展示**：`#/trades` 路由，KPI + 14 字段明细 + 5 个交叉统计表 + LLM 严谨分析区块（带颜色高亮 + 板块止损买入点跟踪）。

> ⚠️ 示例数据仅供演示，**请删除示例交易并录入真实记录**。LLM 分析严格基于真实数据，禁止编造。

## 数据来源（真实性说明）

- 冰川复盘：本地流程经**通达信（tdx）/ 腾讯自选股（westock）**真实行情接口获取——涨停跌停家数、指数点位、主力资金逐日序列等，报告中均标注来源与口径，非编造
- 资金流向：**东方财富公开行情接口**（参考站实时直连）

## 部署

**线上地址：<https://keyue0.github.io/stock-web/>**

仓库：<https://github.com/Keyue0/Keyue0.github.io>（`<username>.github.io` 自动启用 GitHub Pages）

### ★ 仓库结构（别推错位置）

本目录**不是**仓库根目录，而是仓库里的一个**子目录**。仓库实际布局：

```
Keyue0.github.io/            ← 仓库根 = Pages 根 = https://keyue0.github.io/
├── auto/                    ← 另一个独立项目（Bing Auto 复盘数据）
│   └── data/                ← ★ 由 GitHub Actions 每日自动提交，勿手改
├── stock-web/               ← 本应用（= 本目录的内容）
└── .github/workflows/
    └── bing-auto-daily.yml  ← 每日 12:00 / 16:00 自动更新 auto/data/
```

因此**不要**在本目录里 `git init` 然后推到仓库根 —— 那会把本应用的文件铺到根目录，
覆盖 `auto/` 项目。正确做法是把它同步到仓库的 `stock-web/` 子目录下。

`bing-auto-daily.yml` **只 `git add auto/data/`**，不碰 `stock-web/`，
所以手动推送本应用不会和自动化冲突。

### 推送步骤

**推荐：直接用脚本**（推荐，已封装安全检查和身份配置）

```bash
python tools/push_pages.py --dry-run      # 只看会改什么，不提交
python tools/push_pages.py                # 同步 + 提交 + 推送
python tools/push_pages.py -m "自定义提交信息"
```

脚本做的事：全新克隆仓库（保证工作区干净且已是最新 main）→
**检查目标前缀有没有「远程独有文件」（有就中止，避免误删）** →
镜像本地到 `stock-web/` → 只 `git add stock-web` → 提交推送。
`--dry-run` 留下的是干净状态，下次运行不受影响（因为每次都是全新克隆）。

**手动步骤**（脚本不可用时）

```bash
# 1) 克隆仓库
git clone git@github.com:Keyue0/Keyue0.github.io.git /path/to/pages-repo

# 2) ★ 先确认目标前缀没有「远程独有文件」，为 0 才可安全镜像
diff -rq /path/to/pages-repo/stock-web . | grep '^Only in.*pages-repo'

# 3) 同步（已确认无独有文件才执行 rm -rf）
rm -rf /path/to/pages-repo/stock-web
cp -r . /path/to/pages-repo/stock-web

# 4) 提交推送（只加 stock-web 这一个前缀）
cd /path/to/pages-repo
git add stock-web
git commit -m "stock-web: <改动摘要>"
git push
```

推送后 GitHub Pages 约 20 秒生效。用 SSH 推送（本机 `~/.ssh/id_ed25519` 已配好，
`ssh -T git@github.com` 应返回 `Hi Keyue0!`）。

> ⚠️ 线上数据会「静默变旧」：每日流程会更新本地的
> `data/industry_crowding.json`，但仓库里的 Actions **只提交 `auto/data/`**，
> 不碰 `stock-web/`。所以线上 `#/industry` 面板的数据会停在上次推送的状态，
> 需要手动跑 `push_pages.py` 才更新。想每天自动推的话，在 `daily.py` 末尾加一步调用即可。

### 推送前自检

```bash
node tools/smoke_view.js blogger capital home industry ladder lhb pool review sentiment trades
```

10/10 通过再推。视图渲染报错在浏览器里表现为整页白屏，但 HTTP 仍是 200，
只看「资源能不能打开」是发现不了的。
