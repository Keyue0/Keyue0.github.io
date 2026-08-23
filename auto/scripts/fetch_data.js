#!/usr/bin/env node
/* ============================================================
   Bing · GitHub Actions 自动数据脚本（云端版）
   ------------------------------------------------------------
   职责：定时自动拉取真实行情，生成网站 data/ 全部 JSON，
         推送到 GitHub 后由 Pages 自动展示。电脑关机不影响。
   数据源（全部公开接口，无需申请）：
     1. 东财 push2ex   —— 涨停池 / 跌停池（含连板数、涨停原因）
     2. 腾讯 qt.gtimg.cn —— 大盘指数点位（GBK 解码）
     3. 东财 push2delay —— 涨跌家数、板块资金流
     4. 东财 datacenter-web —— 龙虎榜明细
   口径：尽量对齐本地爱在冰川复盘（涨停家数以涨停池 total 为准等），
         与通达信口径的差异在数据 note 中标注。
   用法：node fetch_data.js [--date=YYYY-MM-DD] [--slot=am|pm] [--lookback=N]
   默认：自动取最近交易日；--slot 默认 pm（收盘正式版）
   - slot=pm   → 生成正式全套（reviews/<date>.json + sentiment + fund/ladders/pools/lhb）
   - slot=am   → 只生成盘中快照存档（reviews/<date>_am.json，前端不展示，供追溯）
   - lookback=N → 追溯最近 N+1 个交易日，每个交易日按当前 slot 各生成一条记录
                  （如 --lookback=1 生成"昨天 + 今天"两天；用于漏跑补数据）
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

/* ---------- 通用工具 ---------- */
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function jget(url, referer = 'https://quote.eastmoney.com/') {
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, Referer: referer },
    signal: AbortSignal.timeout(20000)
  });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url.slice(0, 80));
  const t = await r.text();
  try { return JSON.parse(t); } catch (e) { throw new Error('JSON解析失败 ' + url.slice(0, 80)); }
}

async function gbk(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
  const buf = await r.arrayBuffer();
  return new TextDecoder('gbk').decode(buf);
}

const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const ymdCompact = d => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;

/* 判断某天是否为交易日（涨停池有数据即交易日） */
async function isTradeDay(dateObj) {
  const ds = ymdCompact(dateObj);
  try {
    const j = await jget(`https://push2ex.eastmoney.com/getTopicZTPool?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt&Pageindex=0&pagesize=3&sort=fbt%3Aasc&date=${ds}`);
    const total = j.data && j.data.total ? j.data.total : (j.data && j.data.pool ? j.data.pool.length : 0);
    return total > 0;
  } catch (e) { return false; }
}

/* 最近交易日：从 want（或今天）往前找第一个交易日 */
async function resolveTradeDate(want) {
  const base = want ? new Date(want) : new Date();
  for (let i = 0; i < 10; i++) {
    const d = new Date(base);
    d.setDate(d.getDate() - i);
    const wd = d.getDay();
    if (wd === 0 || wd === 6) continue; // 周末跳过
    if (await isTradeDay(d)) {
      return { date: ymd(d), compact: ymdCompact(d), weekday: '周' + '日一二三四五六'[wd] };
    }
    console.log(`  ${ymd(d)} 涨停池为空，非交易日，回溯`);
    await sleep(400);
  }
  throw new Error('无法确定最近交易日');
}

/* 追溯：列出从基准日往前共 count 个交易日（含基准日），跨周末/节假日 */
async function listTradeDays(want, count) {
  const base = want ? new Date(want) : new Date();
  const days = [];
  for (let i = 0; i < 60 && days.length < count; i++) {
    const d = new Date(base);
    d.setDate(d.getDate() - i);
    const wd = d.getDay();
    if (wd === 0 || wd === 6) continue;
    if (await isTradeDay(d)) {
      days.push({ date: ymd(d), compact: ymdCompact(d), weekday: '周' + '日一二三四五六'[wd] });
      await sleep(300);
    }
  }
  if (!days.length) throw new Error('无法定位交易日（--lookback=' + count + '）');
  return days.reverse();   // 旧→新，逐个生成（覆盖式，幂等）
}

/* ---------- 1. 涨停/跌停/连板池 ---------- */
async function fetchZT(dateC, pageSize = 600) {
  const j = await jget(`https://push2ex.eastmoney.com/getTopicZTPool?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt&Pageindex=0&pagesize=${pageSize}&sort=fbt%3Aasc&date=${dateC}`);
  const pool = (j.data && j.data.pool) || [];
  return pool.map(p => ({
    code: p.c, name: p.n, lbc: p.lbc || 1,      // 连板数
    hybk: p.hybk || '',                           // 涨停原因/行业
    amount: p.amount || 0,                        // 成交额(元)
    fund: p.fund || 0,                            // 封单资金(元)
    zttj: p.zttj || ''                            // 涨停统计
  }));
}

async function fetchDT(dateC, pageSize = 300) {
  const j = await jget(`https://push2ex.eastmoney.com/getTopicDTPool?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt&Pageindex=0&pagesize=${pageSize}&sort=fund%3Aasc&date=${dateC}`);
  const pool = (j.data && j.data.pool) || [];
  return pool.map(p => ({ code: p.c, name: p.n, hybk: p.hybk || '' }));
}

/* ---------- 2. 大盘指数（腾讯 GBK） ---------- */
async function fetchIndex() {
  const t = await gbk('https://qt.gtimg.cn/q=sh000001,sz399001,sz399006');
  const out = {};
  t.split(';').forEach(line => {
    const m = line.match(/v_(\w+)="([^"]*)"/);
    if (!m) return;
    const f = m[2].split('~');
    const key = f[2] === '000001' ? 'sh' : (f[2] === '399001' ? 'sz' : (f[2] === '399006' ? 'cyb' : f[2]));
    out[key] = {
      name: f[1], code: f[2], price: parseFloat(f[3]) || 0,
      prev: parseFloat(f[4]) || 0, open: parseFloat(f[5]) || 0,
      change: parseFloat(f[31]) || 0, pct: parseFloat(f[32]) || 0,
      amountYi: (parseFloat(f[37]) || 0) / 10000   // f37=成交额(万元)，/10000=亿元
    };
  });
  return out;
}

/* ---------- 3. 涨跌家数（东财 push2delay ulist f104/105/106） ---------- */
async function fetchUpDown() {
  const j = await jget('https://push2delay.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=f104,f105,f106&secids=1.000001,0.399001');
  const arr = (j.data && j.data.diff) || [];
  let up = 0, down = 0, flat = 0;
  arr.forEach(x => { up += x.f104 || 0; down += x.f105 || 0; flat += x.f106 || 0; });
  return { up, down, flat };
}

/* ---------- 4. 板块资金流（东财 push2delay clist f62） ---------- */
async function fetchSectorFund() {
  const j = await jget('https://push2delay.eastmoney.com/api/qt/clist/get?fid=f62&po=1&pz=60&pn=1&np=1&fltt=2&invt=2&ut=b2884a393a59ad64002292a3e90d46a5&fs=m:90+t:2&fields=f12,f14,f2,f3,f62,f184');
  const arr = (j.data && j.data.diff) || [];
  return arr.map(x => ({
    code: x.f12, name: x.f14,
    price: x.f2, pct: x.f3,
    mainNet: (x.f62 != null ? x.f62 : 0) / 1e8,    // 主力净流入(亿)
    mainNetPct: x.f184 != null ? x.f184 : null
  }));
}

/* ---------- 5. 龙虎榜（东财 datacenter） ---------- */
async function fetchLHB(dateStr) {
  const url = 'https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_DAILYBILLBOARD_DETAILSNEW&columns=ALL&filter=(TRADE_DATE%3D%27' + dateStr + '%27)&pageNumber=1&pageSize=30&sortTypes=-1&sortColumns=BILLBOARD_NET_AMT&source=WEB&client=WEB';
  const j = await jget(url, 'https://data.eastmoney.com/');
  return (j.result && j.result.data) || [];
}

/* ---------- 情绪档位判定（规则化，口径对齐冰川框架） ---------- */
function sentimentLevel(limitUp, limitDown, maxBoard, ratio) {
  if (limitUp >= 60 && limitDown <= 15 && maxBoard >= 4 && ratio >= 1) return '亢奋';
  if (limitUp >= 40 && limitDown <= 20) return '修复';
  if (limitUp >= 30 && limitDown <= 25) return '中枢';
  if (limitUp < 30 || limitDown > 25) return '冰点';
  return '退潮';
}

/* ---------- 写 JSON ---------- */
function writeJson(rel, obj) {
  const p = path.join(DATA, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8');
  console.log('  ✓ data/' + rel);
}

function upsertIndex(rel, entry) {
  const p = path.join(DATA, rel);
  let idx = [];
  try { idx = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { idx = []; }
  idx = idx.filter(x => x.date !== entry.date);
  idx.unshift(entry);
  writeJson(rel, idx);
}

/* ============================================================
   runDay：生成单个交易日的完整数据（am 存 _am 快照 / pm 存正式版）
   ============================================================ */
async function runDay(td, isAm) {
  /* --- 拉取全部数据 --- */
  const [ztList, dtList, idx, ud, fundList, lhbList] = await Promise.all([
    fetchZT(td.compact),
    fetchDT(td.compact),
    fetchIndex(),
    fetchUpDown(),
    fetchSectorFund(),
    fetchLHB(td.date).catch(() => [])
  ]);

  const limitUp = ztList.length;
  const limitDown = dtList.length;
  const maxBoard = ztList.reduce((m, x) => Math.max(m, x.lbc), 1);
  const chain = ztList.filter(x => x.lbc >= 2);
  const chainCount = chain.length;
  const ratio = ud.down > 0 ? +(ud.up / ud.down).toFixed(2) : 0;   // 涨/跌家数比（与本地口径一致）
  const totalAmount = (idx.sh ? idx.sh.amountYi : 0) + (idx.sz ? idx.sz.amountYi : 0);  // 沪+深（深成指已含创业板）
  const sentiment = sentimentLevel(limitUp, limitDown, maxBoard, ratio);

  /* --- 板块效应：涨停原因聚合（≥3家） --- */
  const sectorMap = {};
  ztList.forEach(x => {
    const k = x.hybk || '其他';
    sectorMap[k] = sectorMap[k] || [];
    sectorMap[k].push(x);
  });
  const sectorEffects = Object.entries(sectorMap)
    .filter(([, v]) => v.length >= 3)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([k, v]) => ({
      sector: k, count: v.length,
      maxBoard: Math.max(...v.map(x => x.lbc)),
      leaders: v.filter(x => x.lbc >= 2).slice(0, 4).map(x => x.name + (x.lbc > 1 ? x.lbc + '板' : ''))
    }));

  /* --- 连板梯队 --- */
  const boards = [];
  for (let b = maxBoard; b >= 2; b--) {
    const rows = chain.filter(x => x.lbc === b).map(x => ({
      name: x.name, code: x.code, sector: x.hybk,
      type: x.fund > 0 && x.amount < x.fund * 3 ? '一字板' : '换手板'
    }));
    if (rows.length) boards.push({ board: b, rows });
  }

  /* --- 主力资金 Top 流入/流出 --- */
  const inTop = [...fundList].sort((a, b) => b.mainNet - a.mainNet).slice(0, 5);
  const outTop = [...fundList].sort((a, b) => a.mainNet - b.mainNet).slice(0, 5);
  const totalIn = fundList.reduce((s, x) => s + x.mainNet, 0);

  /* ============================================================
     生成九段复盘内容（全部基于真实数据 + 规则化判定）
     ============================================================ */
  const sec1 = `**上证收 ${idx.sh ? idx.sh.price : '--'}（${idx.sh ? (idx.sh.pct >= 0 ? '+' : '') + idx.sh.pct + '%' : '--'}）** / **深成指 ${idx.sz ? idx.sz.price : '--'}（${idx.sz ? (idx.sz.pct >= 0 ? '+' : '') + idx.sz.pct + '%' : '--'}）** / **创业板 ${idx.cyb ? idx.cyb.price : '--'}（${idx.cyb ? (idx.cyb.pct >= 0 ? '+' : '') + idx.cyb.pct + '%' : '--'}）**

两市成交 **${totalAmount.toFixed(2)} 亿**（沪+深+创合计口径）。

涨 **${ud.up}** 家 / 跌 **${ud.down}** 家 / 平 **${ud.flat}** 家（涨跌比 ${ratio.toFixed(2)}，${ratio >= 1 ? '涨多跌少' : '跌多涨少'}）。
涨停 **${limitUp}** 家 / 跌停 **${limitDown}** 家。
连板梯队：**${boards.map(b => b.board + ' 板 ' + b.rows.length + ' 家').join('、') || '无连板'}**，最高 **${maxBoard} 板**。

情绪档位：**${sentiment}**

> 数据来源（云端自动版）：东财涨停/跌停池（push2ex）、腾讯行情（qt.gtimg.cn）、东财涨跌家数（push2delay）。口径与通达信略有差异，精修以本地复盘为准。`;

  const sec2 = `> 对照文件：云端自动版不读取本地历史复盘（无跨会话记忆）

**前日情绪定位**：—（首次运行或由本地精修覆盖）
**前日预判**：—

本段为框架占位。如需"次日回头看验证"，请以本地冰川复盘（通达信口径）为准。`;

  const sec3 = sectorEffects.length
    ? '**有效板块（涨停 ≥3 家）**：\n\n' +
      '| 板块 | 涨停家数 | 最高板 | 代表个股 |\n|---|---|---|---|\n' +
      sectorEffects.map(s => `| ${s.sector} | **${s.count}** | ${s.maxBoard}板 | ${s.leaders.join('、') || '—'} |`).join('\n') +
      `\n\n> 板块效应判断：今日板块效应${sectorEffects.length >= 3 ? '明显，多主线并行' : '一般，主线分散'}，**${sectorEffects[0] ? sectorEffects[0].sector + '（' + sectorEffects[0].count + '家）' : '无明显强势板块'}** 领涨。`
    : '**有效板块（涨停 ≥3 家）**：无\n\n> 板块效应判断：今日无达到 3 家涨停的板块，赚钱效应集中在个股层面。';

  const sec4 = boards.length
    ? '**高度板梯队**：\n\n' +
      boards.map(b => {
        const t = `| ${b.board}板 | ${b.rows.map(r => `${r.name} ${r.code}（${r.type}）`).join('、')} | ${b.rows[0].sector} |`;
        return t;
      }).join('\n') +
      `\n\n> 龙头判断：最高 **${maxBoard} 板**，连板 **${chainCount} 家**。${chainCount >= 15 ? '连板梯队完整，情绪承接良好' : chainCount >= 8 ? '连板梯队一般，市场有承接但高度受限' : '连板梯队薄弱，情绪处于' + (limitUp < 30 ? '冰点' : '修复初期')}。`
    : '**高度板梯队**：无连板个股\n\n> 龙头判断：今日无 2 板以上个股，市场高度被压至 1 板，情绪冰点。';

  const sec5 = `**行业板块合计**：主力净 **${totalIn >= 0 ? '+' : ''}${totalIn.toFixed(2)} 亿**（东财 60 行业板块资金合计口径）。

**当日净流入 Top5 板块**：

| 排名 | 板块 | 净流入（亿） | 涨跌幅 |
|---|---|---|---|
${inTop.map((x, i) => `| ${i + 1} | ${x.name} | **+${x.mainNet.toFixed(2)}** | ${x.pct >= 0 ? '+' : ''}${x.pct}% |`).join('\n')}

**当日净流出 Top5 板块**：

| 排名 | 板块 | 净流出（亿） | 涨跌幅 |
|---|---|---|---|
${outTop.map((x, i) => `| ${i + 1} | ${x.name} | **${x.mainNet.toFixed(2)}** | ${x.pct >= 0 ? '+' : ''}${x.pct}% |`).join('\n')}

> 资金判断：${inTop[0] ? '**' + inTop[0].name + '** 净流入 ' + inTop[0].mainNet.toFixed(2) + ' 亿居首' : '资金面整体偏弱'}；${outTop[0] ? '**' + outTop[0].name + '** 净流出 ' + Math.abs(outTop[0].mainNet).toFixed(2) + ' 亿居前' : ''}。
> 口径标注：板块主力净流入来自东财 push2delay 板块资金流接口，与通达信 zjlx 个股口径近似，数值略有差异。`;

  const sec6 = `> 扫描范围：东财行业板块资金流（盘中/收盘快照）。

**资金流入且上涨的板块（候选）**：

| 板块 | 主力净流入（亿） | 当日涨跌幅 |
|---|---|---|
${inTop.slice(0, 5).map(x => `| ${x.name} | **+${x.mainNet.toFixed(2)}** | ${x.pct >= 0 ? '+' : ''}${x.pct}% |`).join('\n')}

> 机会判断：云端自动版仅基于「资金流入 + 当日上涨」初筛，**未含 120 日回撤 / 20 日涨幅 / 5 日涨停家数**等低位右侧判定（需历史K线）。低位右侧深度扫描以本地冰川复盘（通达信口径）为准。`;

  const sec7 = `**共振判定**：**${ratio >= 1 && maxBoard >= 4 && totalIn > 0 ? '共振' : '背离'}**

| 维度 | 信号 | 数据 |
|---|---|---|
| 趋势资金 | 板块资金净流入 | ${totalIn >= 0 ? '+' : ''}${totalIn.toFixed(2)} 亿（东财口径） |
| 情绪梯队 | 高度板与连板梯队 | 最高 ${maxBoard} 板，连板 ${chainCount} 家 |
| 涨跌家数 | 多空力量 | 涨 ${ud.up} / 跌 ${ud.down}（${ratio >= 1 ? '涨多' : '跌多'}） |

**判定依据**：
- ${ratio >= 1 ? '涨跌家数偏多' : '涨跌家数偏空'}，${totalIn >= 0 ? '板块资金净流入为正' : '板块资金净流出'}，${maxBoard >= 4 ? '情绪高度尚可' : '情绪高度不足（最高仅 ' + maxBoard + ' 板）'}
- 云端自动版为规则化判定（不含历史对照），精修以本地复盘为准。

> 共振/背离判断：${ratio >= 1 && maxBoard >= 4 && totalIn > 0 ? '**共振则顺势**，可小仓参与资金+情绪双确认的方向。' : '**背离则控仓**。指数/资金与情绪高度不匹配，只能小仓试探低位共振方向，不能追高。'}`;

  const sec8 = `**仓位建议**：**${limitUp < 30 || limitDown > 25 ? '0-20%（冰点防御）' : '30%（半仓上限内）'}**

**目标板块**：
${inTop.slice(0, 3).map((x, i) => `${i + 1}. **${x.name}**（资金净流入 +${x.mainNet.toFixed(2)} 亿）——低吸为主，确认板块资金延续净流入再参与`).join('\n')}

**放弃条件（系统性）**：
- 上证跌破 **${idx.sh ? (idx.sh.price * 0.985).toFixed(0) : '—'}**（-1.5% 阈值） → 空仓
- 跌停家数 > **20** → 空仓
- 涨停家数 < **30** → 空仓

**放弃条件（结构性）**：
- 目标板块资金转为净流出 → 放弃该板块
- 昨日涨停指数继续 -2% 以下 → 情绪退潮，整体降仓

> 计划总结：云端自动版为规则化建议，**候选池个股与精确买卖点以本地冰川复盘（通达信口径）为准**。`;

  const sec9 = `> ${sentiment === '冰点' ? '冰点防守，等跌停收敛、涨停回暖再看机会。' : sentiment === '退潮' ? '退潮期不恋战，管住手等新周期。' : sentiment === '亢奋' ? '亢奋期防分歧，去弱留强。' : '修复日不是主升日，只做有资金有情绪有低位的线，其余看戏。'}小肉小面都是肉，先下手为强。

> ⚠️ 免责声明：本报告为框架化复盘/推演（云端自动版），数据来自东财/腾讯公开接口，不构成投资建议。`;

  const sections = [
    { title: '大盘情绪', content: sec1 },
    { title: '次日回头看验证', content: sec2 },
    { title: '板块效应', content: sec3 },
    { title: '龙头与梯队', content: sec4 },
    { title: '主力资金流向分析', content: sec5 },
    { title: '板块低位右侧机会识别', content: sec6 },
    { title: '趋势资金与情绪梯队共振背离', content: sec7 },
    { title: '明日计划', content: sec8 },
    { title: '一句话收尾', content: sec9 }
  ];

  const summary = `指数${idx.sh ? (idx.sh.pct >= 0 ? '稳' : '弱') : '—'}、涨停${limitUp}家/跌停${limitDown}家、最高${maxBoard}板——情绪${sentiment}档，${sectorEffects[0] ? sectorEffects[0].sector + '领涨' : '主线分散'}，${ratio >= 1 ? '涨多跌少' : '跌多涨少'}。云端自动版，精修以本地复盘为准。`;

  /* ============================================================
     写入 data/ 全部 JSON（与前端完全兼容）
     ============================================================ */
  console.log('\n--- 写入数据文件 (' + td.date + ' ' + (isAm ? 'am' : 'pm') + ') ---');

  const sourceNote = isAm
    ? '盘中快照（12:00，未收盘，数据为未定型快照，仅供参考）'
    : '收盘正式（16:00，数据已定型）';

  // 1. reviews —— am 存盘中快照（_am.json，前端不展示），pm 存正式版
  if (isAm) {
    writeJson(`reviews/${td.date}_am.json`, {
      date: td.date, weekday: td.weekday, summary,
      sentiment, limitUp: String(limitUp), limitDown: String(limitDown),
      amount: totalAmount.toFixed(2),
      source: 'github-actions-am', note: '盘中快照存档：' + sourceNote + '（东财/腾讯公开接口），前端默认展示收盘正式版',
      sections
    });
    console.log('  ✅ 盘中快照已存档: ' + td.date + '_am（情绪' + sentiment + '，涨停' + limitUp + '/跌停' + limitDown + '）');
    return;
  }

  writeJson(`reviews/${td.date}.json`, {
    date: td.date, weekday: td.weekday, summary,
    sentiment, limitUp: String(limitUp), limitDown: String(limitDown),
    amount: totalAmount.toFixed(2),
    source: 'github-actions', note: '云端自动生成（东财/腾讯公开接口），本地精修复盘可覆盖。' + sourceNote,
    sections
  });
  upsertIndex('reviews/index.json', {
    date: td.date, weekday: td.weekday, sentiment,
    limitUp: String(limitUp), limitDown: String(limitDown),
    amount: totalAmount.toFixed(2), summary
  });

  // 2. sentiment（累计追加）
  const sentPath = path.join(DATA, 'sentiment.json');
  let sent = [];
  try { sent = JSON.parse(fs.readFileSync(sentPath, 'utf8')); } catch (e) { sent = []; }
  sent = sent.filter(x => x.date !== td.date);
  sent.push({ date: td.date, limitUp, limitDown, topBoard: maxBoard, ratio, amount: +totalAmount.toFixed(2), upCount: ud.up, downCount: ud.down, sentiment });
  sent.sort((a, b) => a.date < b.date ? -1 : 1);
  writeJson('sentiment.json', sent);

  // 3. fund 板块资金快照
  writeJson(`fund/${td.date}.json`, {
    date: td.date, unit: 'yi', source: 'eastmoney-push2delay',
    note: '板块主力净流入（亿）。来源：东财 push2delay 板块资金流接口（云端自动）。',
    rows: fundList.map(x => ({ name: x.name, main: x.mainNet, pct: x.pct }))
  });
  upsertIndex('fund/index.json', { date: td.date });

  // 4. ladders 连板梯队
  writeJson(`ladders/${td.date}.json`, {
    date: td.date,
    meta: { limitUp, limitDown, maxBoard, chainCount,
      note: `涨停${limitUp}家/跌停${limitDown}家，最高${maxBoard}板，连板${chainCount}家。云端自动版（东财涨停池口径）。` },
    boards
  });
  upsertIndex('ladders/index.json', { date: td.date });

  // 5. pools 候选池（资金流入板块代表）
  const poolRows = [];
  inTop.slice(0, 3).forEach((s) => {
    const leaders = ztList.filter(x => x.hybk === s.name);
    const rep = leaders[0];
    poolRows.push({
      sector: s.name,
      name: rep ? rep.name : (s.name + '代表'),
      code: rep ? rep.code : '—',
      buy: null, stop: null, target: null, status: '观察中',
      note: `主力净流入+${s.mainNet.toFixed(2)}亿（东财口径），板块当日${s.pct >= 0 ? '+' : ''}${s.pct}%。买点/止损/目标需以本地精修复盘为准。`
    });
  });
  writeJson(`pools/${td.date}.json`, {
    date: td.date,
    note: '来源：GitHub Actions 自动生成（东财板块资金流 Top3）。买点/止损/目标为占位，精修以本地冰川复盘为准。',
    pools: poolRows
  });
  upsertIndex('pools/index.json', { date: td.date });

  // 6. lhb 龙虎榜
  const institutions = lhbList
    .filter(x => x.EXPLAIN && /机构/.test(x.EXPLAIN))
    .slice(0, 8)
    .map(x => ({
      name: x.SECURITY_NAME_ABBR, code: x.SECURITY_CODE,
      buy: +(x.BILLBOARD_BUY_AMT / 1e8).toFixed(2), net: +(x.BILLBOARD_NET_AMT / 1e8).toFixed(2),
      sector: (x.EXPLAIN || '').split('，')[0] || '', note: x.EXPLAIN || ''
    }));
  writeJson(`lhb/${td.date}.json`, {
    date: td.date,
    institutions,
    brokerages: [],
    hotspots: [],
    summary: `云端自动版：龙虎榜上榜个股（按净买额排序）。机构买入明细见上表；游资席位/名号映射需本地精修补充（人工/社区信息）。`,
    lasa: [],
    note: '来源：东财 datacenter RPT_DAILYBILLBOARD_DETAILSNEW（云端自动）。游资名号与盘面解读以本地复盘为准。'
  });
  upsertIndex('lhb/index.json', { date: td.date });

  // 7. views 保留
  const viewsPath = path.join(DATA, 'views/index.json');
  if (!fs.existsSync(viewsPath)) writeJson('views/index.json', []);

  console.log('  ✅ 数据生成完成: ' + td.date + '（情绪' + sentiment + '，涨停' + limitUp + '/跌停' + limitDown + '）');
  console.log('  summary: ' + summary);
}

/* ============================================================
   main：解析参数 → 计算交易日列表 → 逐个生成
   ============================================================ */
(async () => {
  const want = process.argv.find(a => a.startsWith('--date='));
  const wantDate = want ? want.split('=')[1] : null;
  const wantSlot = process.argv.find(a => a.startsWith('--slot='));
  const slot = wantSlot ? wantSlot.split('=')[1] : 'pm';
  const isAm = slot === 'am';
  const wantLb = process.argv.find(a => a.startsWith('--lookback='));
  const lookback = wantLb ? parseInt(wantLb.split('=')[1], 10) || 0 : 0;

  console.log('Bing 云端数据脚本启动（' + (isAm ? '盘中快照 am' : '收盘正式 pm') + '，追溯 ' + lookback + ' 天）');

  const days = await listTradeDays(wantDate, lookback + 1);
  console.log('待处理交易日: ' + days.map(d => d.date).join(' → '));

  for (const td of days) {
    try {
      await runDay(td, isAm);
    } catch (e) {
      console.error('  ⚠️ ' + td.date + ' 生成失败: ' + e.message);
      // 追溯模式下单日失败不中断，继续下一天
    }
    await sleep(500);
  }
  console.log('\n全部完成 ✅');
})().catch(e => {
  console.error('❌ 脚本失败:', e.message);
  process.exit(1);
});
