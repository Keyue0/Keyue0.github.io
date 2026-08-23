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

## 目录结构

```
Bing/
├── index.html          主壳（导航 + 内容容器）
├── css/style.css       深色主题样式
├── js/
│   ├── app.js          路由核心 + 工具函数 + 视图注册
│   └── views/
│       ├── home.js     首页视图
│       ├── review.js   冰川复盘视图
│       └── capital.js  资金流向视图（iframe 内嵌参考站）
└── data/
    ├── reviews/        复盘数据 JSON（index.json 为索引）
    └── fund/           资金快照 JSON（index.json 为索引）
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

## 如何更新复盘数据

复盘流程（本地）生成报告后，将数据同步到本仓库：

1. `data/reviews/<日期>.json` —— 九段复盘内容（date/weekday/summary/sentiment/limitUp/limitDown/amount/sections）
2. `data/reviews/index.json` —— 复盘索引（按日期降序，最新在前）
3. `data/fund/<日期>.json` —— 当日板块资金快照（rows: name/main(元)/pct）
4. `data/fund/index.json` —— 资金快照索引

然后推送到 `main` 分支，GitHub Pages 自动更新（https://keyue0.github.io/）。

## 数据来源（真实性说明）

- 冰川复盘：本地流程经**通达信（tdx）/ 腾讯自选股（westock）**真实行情接口获取——涨停跌停家数、指数点位、主力资金逐日序列等，报告中均标注来源与口径，非编造
- 资金流向：**东方财富公开行情接口**（参考站实时直连）

## 部署

仓库：https://github.com/Keyue0/Keyue0.github.io（`<username>.github.io` 自动启用 GitHub Pages）

本地推送：
```bash
git init && git add . && git commit -m "Bing v1"
git remote add origin https://github.com/Keyue0/Keyue0.github.io.git
git branch -M main && git push -u origin main
```
