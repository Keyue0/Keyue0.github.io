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

/* ---------- 5b. 龙虎榜席位明细（买入/卖出营业部） ----------
   识别知名游资（章盟主/方新侠/小鳄鱼/作手新一/成都系等）+ 机构专用席位 + 拉萨天团 */
const LHB_BROKER_KNOWN = [
  { match: '章盟主', seat: ['银河证券绍兴', '海通证券上海建国西路'] },
  { match: '方新侠', seat: ['国泰君安南京太平南路', '华泰证券南京太平南路'] },
  { match: '小鳄鱼', seat: ['东方财富拉萨团结路', '兴业证券福州湖东路'] },
  { match: '作手新一', seat: ['国泰君安南京太平南路'] },
  { match: '成都系', seat: ['成都', '天府'] },
  { match: '量化打板', seat: ['中国中投深圳益田路', '国金证券', '上海分公司'] },
  { match: '江苏帮', seat: ['南京', '苏州', '无锡'] },
  { match: '浙江帮', seat: ['宁波', '杭州', '绍兴', '温州', '台州'] },
  { match: '拉萨天团', seat: ['拉萨'] }
];
const LHB_BROKER_FOCUS = ['机构专用', '章盟主', '方新侠', '小鳄鱼', '作手新一', '成都系', '量化打板', '拉萨'];

async function fetchLHBBrokerages(dateStr) {
  const base = 'https://datacenter-web.eastmoney.com/api/data/v1/get?columns=ALL&filter=(TRADE_DATE%3D%27' + dateStr + '%27)&pageNumber=1&pageSize=50&source=WEB&client=WEB';
  let buy = [], sell = [];
  try {
    const jb = await jget(base + '&reportName=RPT_BILLBOARD_DAILYDETAILSBUY', 'https://data.eastmoney.com/');
    buy = (jb.result && jb.result.data) || [];
  } catch (e) { /* 忽略 */ }
  try {
    const js = await jget(base + '&reportName=RPT_BILLBOARD_DAILYDETAILSSELL', 'https://data.eastmoney.com/');
    sell = (js.result && js.result.data) || [];
  } catch (e) { /* 忽略 */ }
  if (!buy.length && !sell.length) return [];

  // 按营业部聚合：合并买/卖
  const seats = {};
  buy.forEach(x => {
    const k = x.OPERATEDEPT_NAME || '';
    if (!k) return;
    seats[k] = seats[k] || { name: k, buy: 0, sell: 0, stocks: [] };
    seats[k].buy += (x.BUY || 0) / 1e8;
    seats[k].stocks.push({ stock: (x.SECURITY_NAME_ABBR || x.SECURITY_CODE || ''), type: 'buy', amount: (x.BUY || 0) / 1e8, code: x.SECURITY_CODE || '' });
  });
  sell.forEach(x => {
    const k = x.OPERATEDEPT_NAME || '';
    if (!k) return;
    seats[k] = seats[k] || { name: k, buy: 0, sell: 0, stocks: [] };
    seats[k].sell += (x.SELL || 0) / 1e8;
    seats[k].stocks.push({ stock: (x.SECURITY_NAME_ABBR || x.SECURITY_CODE || ''), type: 'sell', amount: (x.SELL || 0) / 1e8, code: x.SECURITY_CODE || '' });
  });

  // 识别知名游资名号
  const brokerages = Object.values(seats)
    .map(s => {
      let alias = null;
      LHB_BROKER_KNOWN.forEach(k => {
        if (!alias && k.seat.some(seat => s.name.includes(seat))) alias = k.match;
      });
      const today = '买' + s.buy.toFixed(2) + '亿/卖' + s.sell.toFixed(2) + '亿';
      return {
        name: s.name, today, seat: s.name, alias,
        trades: s.stocks.slice(0, 6),
        focus: alias ? ('疑似 ' + alias + ' 席位') : (LHB_BROKER_FOCUS.some(f => s.name.includes(f)) ? '活跃席位' : '')
      };
    })
    .sort((a, b) => (b.buy + b.sell) - (a.buy + a.sell))
    .slice(0, 12);

  // 拉萨天团（散户聚集席位）
  const lasa = Object.values(seats)
    .filter(s => s.name.includes('拉萨'))
    .slice(0, 6)
    .map(s => s.name.replace(/证券营业部|股份有限公司|证券/g, '').replace(/东方财富/g, ''));

  return { brokerages, lasa };
}

/* ---------- 6. 板块历史（资金流日线接口，含收盘点位） ----------
   一个接口同时返回：120日回撤 / 20日涨幅 / 5日·20日主力净额（亿）：
   f51=日期 f52=主力净额(元) f62=收盘点位 f63=涨跌幅
   多域名轮换 + 重试（本地网络对 push2his CDN 偶发不稳定，Actions 环境通常正常） */
const HIST_HOSTS = ['push2his.eastmoney.com', '1.push2his.eastmoney.com', '63.push2his.eastmoney.com'];
async function fetchSectorHist(secid, tries = 3) {
  for (let t = 0; t < tries; t++) {
    for (const host of HIST_HOSTS) {
      try {
        const j = await jget(`https://${host}/api/qt/stock/fflow/daykline/get?lmt=130&klt=101&secid=${secid}&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63,f64,f65`);
        const k = (j.data && j.data.klines) || [];
        if (k.length >= 25) {
          const closes = k.map(x => parseFloat(x.split(',')[11]));
          const mains = k.map(x => parseFloat(x.split(',')[1]));
          const last = closes[closes.length - 1];
          const hi120 = Math.max(...closes.slice(-120));
          const close20ago = closes[closes.length - 21];
          return {
            drawdown: last > 0 && hi120 > 0 ? +(last - hi120) / hi120 * 100 : null,   // 120日回撤(%)
            pct20: close20ago > 0 ? +(last - close20ago) / close20ago * 100 : null,   // 20日涨幅(%)
            fund5: +(mains.slice(-5).reduce((a, b) => a + b, 0) / 1e8).toFixed(2),     // 5日主力净额(亿)
            fund20: +(mains.slice(-20).reduce((a, b) => a + b, 0) / 1e8).toFixed(2),   // 20日主力净额(亿)
            fund5Daily: mains.slice(-5).map(v => +(v / 1e8).toFixed(2))                // 最近5日每日主力净额(亿)
          };
        }
      } catch (e) { /* 换域名 */ }
      await sleep(400);
    }
    await sleep(800);
  }
  return null;
}

/* 沪深300 近20日涨幅（超额收益基准，只拉一次） */
let _hs300 = null;
async function fetchHS300() {
  if (_hs300 !== null) return _hs300;
  const h = await fetchSectorHist('1.000300');
  _hs300 = h ? h.pct20 : null;
  return _hs300;
}

/* ---------- 7. 近5日板块涨停家数（涨停池回溯聚合） ---------- */
async function fetchZTCount5d(anchorDate, n = 5) {
  const days = await listTradeDays(anchorDate, n);   // 旧→新，含 anchor 当日
  const count = {};
  for (const d of days) {
    try {
      const zt = await fetchZT(d.compact, 600);
      zt.forEach(x => { const k = x.hybk || '其他'; count[k] = (count[k] || 0) + 1; });
    } catch (e) { /* 单日失败跳过 */ }
    await sleep(350);
  }
  return count;
}

/* ---------- 8. 昨日涨停表现（赚钱效应核心指标） ----------
   昨日涨停池名单 → 腾讯批量查今日涨跌幅 → 平均涨跌/红盘率/大面比例 */
async function fetchYesterdayZTPerf(todayDateStr) {
  // 找昨日（前一个交易日）
  const days = await listTradeDays(todayDateStr, 2);  // [昨日, 今日]
  const prev = days[0];
  if (!prev) return null;
  let ztList = [];
  try { ztList = await fetchZT(prev.compact, 600); } catch (e) { return null; }
  if (!ztList.length) return null;

  // 批量查今日行情：code → 市场前缀
  const prefix = c => /^(6|68|9)/.test(c) ? 'sh' + c : (/^(0|3)/.test(c) ? 'sz' + c : (/^(4|8|92)/.test(c) ? 'bj' + c : c));
  const codes = ztList.slice(0, 200).map(x => prefix(x.code)).join(',');
  let text = '';
  try {
    const r = await fetch('https://qt.gtimg.cn/q=' + codes, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
    const buf = await r.arrayBuffer();
    text = new TextDecoder('gbk').decode(buf);
  } catch (e) { return null; }

  const today = {};
  text.split(';').forEach(line => {
    const m = line.match(/v_(\w+)="([^"]*)"/);
    if (!m) return;
    const f = m[2].split('~');
    today[f[2]] = parseFloat(f[32]);   // f2=代码, f32=涨跌幅
  });

  const pcts = ztList.map(x => today[x.code]).filter(v => v != null && !isNaN(v));
  if (!pcts.length) return null;
  const avg = pcts.reduce((a, b) => a + b, 0) / pcts.length;
  const red = pcts.filter(v => v > 0).length;
  const bigLoss = pcts.filter(v => v <= -5).length;
  return {
    date: prev.date, count: ztList.length, queried: pcts.length,
    avgPct: +avg.toFixed(2), redRate: +(red / pcts.length * 100).toFixed(1),
    bigLossRate: +(bigLoss / pcts.length * 100).toFixed(1)
  };
}

/* ---------- 9. 板块近5日资金趋势分类（首次流入/连续流入/回补——对齐冰川三分类） ----------
   用板块资金流日线每日序列（真实历史），三分类语义对齐 duckdb_capital_tracker：
   - 首次流入：当日流入，且近5日首次转正（之前无流入记录或长期流出）
   - 连续流入：当日流入，且前一交易日也流入（连续2日+）
   - 前期流出后回补：当日流入，之前曾流入后流出，今日再次转正 */
function classifyFundTrend(fund5, fund20, fund5Daily) {
  if (fund5Daily && fund5Daily.length >= 5) {
    const d = fund5Daily;                       // 最近5日每日主力净额(亿)，d[4]=当日
    const today = d[d.length - 1];
    const yesterday = d[d.length - 2];
    const hasInflow = d.some(v => v > 0);
    const prevInflow = d.slice(0, -1).some(v => v > 0);
    if (today > 0) {
      if (yesterday > 0) return '连续流入';
      if (prevInflow) return '前期流出后回补';   // 之前有流入记录，今日转正
      return '首次流入';                          // 近5日首次流入
    }
    if (today < 0) {
      if (yesterday < 0) return '持续流出';
      return '转向流出';
    }
    return '—';
  }
  if (fund5 > 0 && fund20 > 0) return '连续流入';
  if (fund5 > 0 && fund20 < 0) return '前期流出后回补';
  if (fund5 < 0 && fund20 < 0) return '持续流出';
  if (fund5 < 0 && fund20 > 0) return '转向流出';
  return '—';
}

/* ---------- 11. 次日回头看 + 放弃条件追踪 ----------
   读取前一日复盘 JSON（data/reviews/<前日>.json），提取明日计划的目标板块与放弃条件，
   对比今日实际（指数/涨跌停/目标板块资金），生成验证结果 + abandon_events */
function findPrevReview(dateStr) {
  const dir = path.join(DATA, 'reviews');
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f));
  const prev = files.map(f => f.slice(0, 10)).filter(d => d < dateStr).sort().pop();
  if (!prev) return null;
  try { return JSON.parse(fs.readFileSync(path.join(dir, prev + '.json'), 'utf8')); }
  catch (e) { return null; }
}

/* 从复盘 JSON 提取明日计划结构（目标板块 / 放弃条件阈值） */
function extractPlan(review) {
  const plan = { sectors: [], conditions: {} };
  const sec8 = (review.sections || []).find(s => /明日计划/.test(s.title));
  if (!sec8) return plan;
  const c = sec8.content || '';
  // 目标板块：1. **有色金属**（...
  const sectorRe = /(\d+)\. \*\*([^*]+)\*\*/g;
  let m;
  while ((m = sectorRe.exec(c))) plan.sectors.push(m[2]);
  // 放弃条件：上证跌破 **3850**（-1.5% 阈值）→ 空仓
  const idxRe = c.match(/上证跌破 \*\*(\d+)/);
  if (idxRe) plan.conditions.index = parseInt(idxRe[1], 10);
  const dtRe = c.match(/跌停家数 > \*\*(\d+)/);
  if (dtRe) plan.conditions.limitDown = parseInt(dtRe[1], 10);
  const luRe = c.match(/涨停家数 < \*\*(\d+)/);
  if (luRe) plan.conditions.limitUp = parseInt(luRe[1], 10);
  return plan;
}

/* 对比前日计划 vs 今日实际，生成回头看结果 */
function buildLookback(prevReview, todayData) {
  const plan = extractPlan(prevReview);
  const res = { prevDate: prevReview.date, prevSentiment: prevReview.sentiment || '', plan, checks: [] };
  const { idx, limitUp, limitDown, fundList } = todayData;

  // 1. 系统性放弃条件验证
  if (plan.conditions.index != null) {
    const price = idx.sh ? idx.sh.price : null;
    const hit = price != null && price < plan.conditions.index;
    res.checks.push({ cond: `上证跌破${plan.conditions.index}`, hit, note: price != null ? `今日上证 ${price}（${hit ? '触发→空仓' : '未触发'}）` : '无指数数据' });
  }
  if (plan.conditions.limitDown != null) {
    const hit = limitDown > plan.conditions.limitDown;
    res.checks.push({ cond: `跌停>${plan.conditions.limitDown}家`, hit, note: `今日跌停 ${limitDown} 家（${hit ? '触发→空仓' : '未触发'}）` });
  }
  if (plan.conditions.limitUp != null) {
    const hit = limitUp < plan.conditions.limitUp;
    res.checks.push({ cond: `涨停<${plan.conditions.limitUp}家`, hit, note: `今日涨停 ${limitUp} 家（${hit ? '触发→空仓' : '未触发'}）` });
  }

  // 2. 目标板块今日实际（资金方向）
  plan.sectors.forEach(name => {
    const f = fundList.find(x => x.name === name);
    res.checks.push({
      cond: `目标板块「${name}」`, hit: null,
      note: f ? `今日资金 ${f.mainNet >= 0 ? '+' : ''}${f.mainNet.toFixed(2)} 亿（${f.mainNet > 0 ? '流入，计划可行' : '流出，放弃该板块'}）` : `今日资金数据缺失（${name}）`
    });
  });

  const triggered = res.checks.filter(c => c.hit === true).length;
  res.verdict = triggered > 0 ? '⚠️ 前日放弃条件触发，今日应执行空仓/放弃对应板块' : (plan.sectors.length ? '前日计划未触发放弃条件，按计划执行' : '前日无结构化计划');
  return res;
}

/* ---------- 10. 跨日资金库（capital_history.json 随仓库提交，跨 run 积累） ----------
   结构：{ "2026-08-20": [ {sector, main, pct}, ... ], "2026-08-21": [...] }
   每次 run：读现有 → 追加当日 → 写回（同日覆盖）。用于：
   - 三分类"首次流入"的历史依据
   - 次日回头看：前日计划板块 vs 今日实际资金/涨跌 */
const HIST_PATH = path.join(DATA, 'capital_history.json');
function loadCapitalHistory() {
  try { return JSON.parse(fs.readFileSync(HIST_PATH, 'utf8')); } catch (e) { return {}; }
}
function appendCapitalHistory(date, fundList) {
  const h = loadCapitalHistory();
  h[date] = fundList.map(x => ({ sector: x.name, code: x.code, main: +x.mainNet.toFixed(2), pct: x.pct }));
  fs.mkdirSync(path.dirname(HIST_PATH), { recursive: true });
  fs.writeFileSync(HIST_PATH, JSON.stringify(h, null, 2), 'utf8');
  console.log('  ✓ data/capital_history.json（已积累 ' + Object.keys(h).length + ' 个交易日）');
  return h;
}

/* ---------- 12. 大模型深度分析（LLM 调用） ----------
   把当日真实数据拼成结构化 prompt → 调 LLM（OpenAI 兼容 /chat/completions）→
   完成九段完整思考后输出：局势分析/为什么/明确方向/精准个股止损与买点/丰富板块。
   兼容环境变量：DEEPSEEK_API_KEY（DeepSeek 官方命名）或 LLM_API_KEY。
   默认模型 deepseek-v4-flash（用户指定），支持 thinking/reasoning 深度思考。
   未配置 key 或调用失败 → 自动回退规则化模板（不中断）。 */
const LLM_API_KEY = process.env.LLM_API_KEY || process.env.DEEPSEEK_API_KEY || '';
const LLM_BASE_URL = process.env.LLM_BASE_URL || 'https://api.deepseek.com/chat/completions';
const LLM_MODEL = process.env.LLM_MODEL || 'deepseek-v4-flash';

async function llmAnalyze(payload) {
  if (!LLM_API_KEY) return null;
  const prompt = `你是资深 A 股短线情绪周期分析师，精通两套方法论：
【爱在冰川框架】短线情绪周期（冰点/修复/中枢/亢奋/退潮）九段复盘：①大盘情绪 ②次日回头看 ③板块效应 ④龙头梯队 ⑤主力资金三分类（首次流入/连续流入/前期流出后回补） ⑥板块低位右侧 ⑦共振/背离 ⑧明日计划 ⑨收尾。板块效应门槛=涨停≥3家；半仓上限纪律（最多半仓，永不梭哈）；不预测（历史对照表述）；明日计划必须含系统性+结构性放弃条件。
【金融风控红线】推荐必须给"条件→操作→风险提示"；止损位必须明确低于买点；数据说话不编造；免责声明固定文末。
【分析要求】你拿到的全是真实行情数据。请像人类资深交易员那样思考：先整体局势判断（为什么今天这样），再逐段推演，最后给出可执行结论。个股推荐必须给精准买点/止损/目标价（基于当日收盘价推算，止损-3%~-5%，目标+8%~+15%）。

以下是 ${payload.date} 的**全部真实行情数据**：
- 指数：上证 ${payload.idx.sh ? payload.idx.sh.price + ' (' + payload.idx.sh.pct + '%)' : '--'} / 深成指 ${payload.idx.sz ? payload.idx.sz.price + ' (' + payload.idx.sz.pct + '%)' : '--'} / 创业板 ${payload.idx.cyb ? payload.idx.cyb.price + ' (' + payload.idx.cyb.pct + '%)' : '--'}，两市成交 ${payload.totalAmount} 亿
- 涨跌家数：${payload.ud.up}涨/${payload.ud.down}跌/${payload.ud.flat}平（涨跌比 ${payload.ratio}），情绪档位 ${payload.sentiment}
- 涨停 ${payload.limitUp} 家 / 跌停 ${payload.limitDown} 家，最高 ${payload.maxBoard} 板，连板 ${payload.chainCount} 家
- 昨日涨停今日表现：${payload.yztPerf ? payload.yztPerf.avgPct + '%（红盘率' + payload.yztPerf.redRate + '%，大面' + payload.yztPerf.bigLossRate + '%）' : '无'}
- 板块资金流入Top10：${payload.inTop.map(x => x.name + '+' + x.mainNet + '亿').join('、')}
- 板块资金流出Top5：${payload.outTop.map(x => x.name + x.mainNet + '亿').join('、')}
- 板块效应（涨停≥3家）：${payload.sectorEffects.map(s => s.sector + '(' + s.count + '家,最高' + s.maxBoard + '板,龙头' + (s.leaders[0] || '') + ')').join('、') || '无'}
- 低位右侧扫描（120日回撤/20日涨幅/资金趋势/近5日涨停）：${payload.lowRight.map(s => s.sector + '(回撤' + s.drawdown + '%,20日' + s.pct20 + '%,' + s.fundTrend + ',涨停' + s.zt5 + '家)').join('、') || '无'}
- 候选板块资金历史（跨日库）：${payload.history ? Object.entries(payload.history).slice(-5).map(([d, arr]) => d + ':' + arr.slice(0, 3).map(x => x.sector + x.main).join(',')).join(' | ') : '无'}
- 龙虎榜：${payload.lhbCount} 只上榜，机构净买 ${payload.lhbInst ? payload.lhbInst.map(x => x.name + '+' + x.net + '亿').join('、') : '无'}
- 龙虎榜游资席位：${payload.lhbBroker ? payload.lhbBroker.slice(0, 5).map(b => b.name + '(' + b.today + ')').join('、') : '无'}

请完成全部九段思考，以 JSON 返回（不要 markdown 代码块）：
{"sec1":"大盘情绪局势分析：为什么今天走成这样+明日情绪推演（80-150字）","sec2":"次日回头看+今日信号验证（若前日有计划则验证，否则写今日关键信号）（60-120字）","sec3":"板块效应深度分析：主线是什么、为什么是它、持续性、明日预期（100-160字）","sec4":"龙头梯队研判：高度板/连板梯队结构、明日晋级预期（60-120字）","sec5":"主力资金解读：真实意图、异常信号、三分类判断、资金主线（80-140字）","sec6":"低位右侧机会：哪个板块值得低吸、为什么、风险点（80-140字）","sec7":"共振/背离判定及依据（60-100字）","sec8":"明日计划：仓位建议(最多半仓)+目标板块+系统性/结构性放弃条件（100-180字，含具体数字）","sec9":"一句话收尾（20-40字，带冰川标志性表达）","pools":[{"sector":"板块","name":"个股","code":"6位","buy":买点,"stop":止损,"target":目标,"status":"观察中/可低吸/放弃","note":"推荐逻辑(为什么+触发条件+风险)"}],"lhb_summary":["龙虎榜盘面观察1","龙虎榜盘面观察2","龙虎榜盘面观察3"]}

pools 要求：3-6只，必须从上述数据中选真实方向（低位右侧扫描优先+板块效应强势板块），每只必须给精准买点/止损/目标价（止损必须<买点，目标>买点，数字基于当日收盘价推算），note 必须含"为什么选它+什么条件触发买入+风险提示"。`;

  try {
    const body = {
      model: LLM_MODEL,
      messages: [
        { role: 'system', content: '你是资深A股短线情绪周期分析师（爱在冰川框架+金融风控红线）。输出必须严格基于给定数据，不编造；所有推荐给条件→操作→风险提示；仓位最多半仓；止损必须低于买点；结尾注明"框架化复盘/推演，不构成投资建议"。' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.5,
      max_tokens: 2500
    };
    // deepseek-v4-flash 深度思考模式（thinking 参数）
    if (/deepseek/.test(LLM_MODEL)) {
      body.reasoning_effort = 'high';
      body.thinking = { type: 'enabled' };
    }
    const r = await fetch(LLM_BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + LLM_API_KEY },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000)
    });
    if (!r.ok) throw new Error('LLM HTTP ' + r.status);
    const j = await r.json();
    const txt = j.choices && j.choices[0] && j.choices[0].message ? j.choices[0].message.content : '';
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('LLM 返回非 JSON');
    const parsed = JSON.parse(m[0]);
    console.log('  ✨ LLM 深度分析已生成（' + LLM_MODEL + '，思考模式）');
    return parsed;
  } catch (e) {
    console.log('  ⚠️ LLM 调用失败，回退规则模板: ' + e.message);
    return null;
  }
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
  const [ztList, dtList, idx, ud, fundList, lhbList, yztPerf, lhbSeats] = await Promise.all([
    fetchZT(td.compact),
    fetchDT(td.compact),
    fetchIndex(),
    fetchUpDown(),
    fetchSectorFund(),
    fetchLHB(td.date).catch(() => []),
    isAm ? Promise.resolve(null) : fetchYesterdayZTPerf(td.date).catch(() => null),
    isAm ? Promise.resolve({ brokerages: [], lasa: [] }) : fetchLHBBrokerages(td.date).catch(() => ({ brokerages: [], lasa: [] }))
  ]);
  const lhbBrokerages = (lhbSeats && lhbSeats.brokerages) || [];
  const lhbLasa = (lhbSeats && lhbSeats.lasa) || [];

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

  /* --- 跨日资金库积累 + 三分类（pm 正式版才入库） --- */
  let capitalHistory = {};
  let lookback = null;
  if (!isAm) {
    capitalHistory = appendCapitalHistory(td.date, fundList);
    // 次日回头看：读取前日复盘 → 对比今日实际
    const prevReview = findPrevReview(td.date);
    if (prevReview) {
      lookback = buildLookback(prevReview, { idx, limitUp, limitDown, fundList });
      console.log('  ℹ️ 次日回头看: ' + lookback.prevDate + ' → ' + td.date + '（触发放弃条件 ' + lookback.checks.filter(c => c.hit === true).length + ' 项）');
    }
  }

  /* ============================================================
     低位右侧扫描（补齐：120日回撤 / 20日涨幅 / 5日涨停家数 / 20日资金）
     扫描对象：当日资金流入 Top10 板块 + 板块效应（涨停≥3家）板块
     ============================================================ */
  const hs300pct20 = await fetchHS300();
  // 扫描目标：资金 Top10 + 涨停效应板块，去重
  const scanSectors = [];
  const seenCodes = new Set();
  fundList.sort((a, b) => b.mainNet - a.mainNet).slice(0, 10).forEach(x => {
    if (!seenCodes.has(x.code)) { seenCodes.add(x.code); scanSectors.push(x); }
  });
  sectorEffects.slice(0, 5).forEach(se => {
    const hit = fundList.find(x => x.name === se.sector);
    if (hit && !seenCodes.has(hit.code)) { seenCodes.add(hit.code); scanSectors.push(hit); }
  });

  // 近5日板块涨停家数（涨停池回溯聚合）
  const ztCount5 = isAm ? {} : await fetchZTCount5d(td.date, 5);

  const lowRight = [];
  if (!isAm) {   // 盘中快照不做历史扫描（快速存档）
    for (const s of scanSectors.slice(0, 12)) {
      const hist = await fetchSectorHist('90.' + s.code);
      if (!hist) continue;
      const zt5 = ztCount5[s.name] || 0;
      const pass = [];
      if (hist.drawdown != null && hist.drawdown <= -15) pass.push('低位');                 // 120日回撤≥15% 视为低位
      if (hist.fund5 > 0 && hist.fund20 > 0) pass.push('资金');                             // 5日+20日主力净流入
      if (zt5 >= 3) pass.push('情绪');                                                       // 近5日涨停≥3家
      lowRight.push({
        sector: s.name, code: s.code,
        drawdown: hist.drawdown, pct20: hist.pct20,
        excess20: hist.pct20 != null && hs300pct20 != null ? +(hist.pct20 - hs300pct20).toFixed(2) : null,
        zt5, fund5: hist.fund5, fund20: hist.fund20,
        fundTrend: classifyFundTrend(hist.fund5, hist.fund20, hist.fund5Daily),
        pass, level: pass.length
      });
      await sleep(300);
    }
    lowRight.sort((a, b) => b.level - a.level);

    /* --- WorkBuddy 增强数据优先覆盖（通达信口径） ---
       若 data/sectors/enhanced_<date>.json 存在（本机 WorkBuddy 用通达信 MCP
       生成后推送），则以其为准（通达信板块指数口径比东财更准）。 */
    const enhPath = path.join(DATA, `sectors/enhanced_${td.date}.json`);
    if (fs.existsSync(enhPath)) {
      try {
        const enh = JSON.parse(fs.readFileSync(enhPath, 'utf8'));
        if (Array.isArray(enh.rows) && enh.rows.length) {
          lowRight.length = 0;
          enh.rows.forEach(r => lowRight.push({
            sector: r.sector, code: r.code || '',
            drawdown: r.drawdown, pct20: r.pct20,
            excess20: r.excess20 != null ? r.excess20 : null,
            zt5: r.zt5 || 0, fund5: r.fund5 != null ? r.fund5 : null,
            fund20: r.fund20 != null ? r.fund20 : null,
            fundTrend: r.fundTrend || classifyFundTrend(r.fund5, r.fund20, null),
            pass: r.pass || [], level: (r.pass || []).length
          }));
          lowRight.sort((a, b) => b.level - a.level);
          console.log('  ℹ️ 使用 WorkBuddy 增强数据（通达信口径）: ' + enhPath);
        }
      } catch (e) { console.log('  ⚠️ enhanced 文件解析失败，回退东财口径: ' + e.message); }
    }
  }

  /* ============================================================
     生成九段复盘内容（全部基于真实数据 + 规则化判定）
     ============================================================ */
  const sec1 = `**上证收 ${idx.sh ? idx.sh.price : '--'}（${idx.sh ? (idx.sh.pct >= 0 ? '+' : '') + idx.sh.pct + '%' : '--'}）** / **深成指 ${idx.sz ? idx.sz.price : '--'}（${idx.sz ? (idx.sz.pct >= 0 ? '+' : '') + idx.sz.pct + '%' : '--'}）** / **创业板 ${idx.cyb ? idx.cyb.price : '--'}（${idx.cyb ? (idx.cyb.pct >= 0 ? '+' : '') + idx.cyb.pct + '%' : '--'}）**

两市成交 **${totalAmount.toFixed(2)} 亿**（沪+深+创合计口径）。

涨 **${ud.up}** 家 / 跌 **${ud.down}** 家 / 平 **${ud.flat}** 家（涨跌比 ${ratio.toFixed(2)}，${ratio >= 1 ? '涨多跌少' : '跌多涨少'}）。
涨停 **${limitUp}** 家 / 跌停 **${limitDown}** 家。
连板梯队：**${boards.map(b => b.board + ' 板 ' + b.rows.length + ' 家').join('、') || '无连板'}**，最高 **${maxBoard} 板**。
${yztPerf ? `昨日涨停今日表现：**${yztPerf.avgPct >= 0 ? '+' : ''}${yztPerf.avgPct}%**（红盘率 ${yztPerf.redRate}%，大面${yztPerf.bigLossRate}%）——${yztPerf.avgPct > 0 ? '昨日追板有肉，赚钱效应' + (yztPerf.redRate > 50 ? '尚可' : '一般') : '昨日追板亏钱，情绪退潮信号'}` : ''}

情绪档位：**${sentiment}**

> 数据来源（云端自动版）：东财涨停/跌停池（push2ex）、腾讯行情（qt.gtimg.cn）、东财涨跌家数（push2delay）。口径与通达信略有差异，精修以本地复盘为准。`;

  const sec2 = lookback
    ? `> 对照前日复盘（${lookback.prevDate}，情绪档位 ${lookback.prevSentiment || '—'}）

**放弃条件验证**：
${lookback.checks.filter(c => c.hit === true).map(c => `- ⚠️ **${c.cond}**：${c.note}`).join('\n') || '- ✅ 前日放弃条件均未触发'}
${lookback.checks.filter(c => c.hit !== true).map(c => `- ${c.cond}：${c.note}`).join('\n')}

**回头看结论**：${lookback.verdict}

> 云端自动版跨日积累：前日计划来自 data/reviews/ 存档，今日实际来自真实行情接口。`
    : (yztPerf
      ? `> 对照：昨日（${yztPerf.date}）涨停 **${yztPerf.count}** 家，今日平均 **${yztPerf.avgPct >= 0 ? '+' : ''}${yztPerf.avgPct}%**（红盘率 ${yztPerf.redRate}%，大面 ${yztPerf.bigLossRate}%）

**昨日情绪验证**：${yztPerf.avgPct > 0 ? (yztPerf.redRate > 50 ? '昨日涨停今日多数红盘，情绪延续' : '昨日涨停小幅收涨，情绪中性') : '昨日涨停今日普跌，**情绪退潮/分歧**，追高谨慎'}

> 云端自动版对昨日涨停池做次日表现验证（腾讯行情口径）；"前日预判对照"以本地冰川复盘（通达信口径）为准。`
      : `> 对照文件：无昨日数据（首次运行或接口未取到）

**昨日情绪验证**：—（数据缺失，以本地冰川复盘为准）`);

  const sec3 = sectorEffects.length
    ? '**有效板块（涨停 ≥3 家）**：\n\n' +
      '| 板块 | 涨停家数 | 最高板 | 代表个股 |\n|---|---|---|---|\n' +
      sectorEffects.map(s => `| ${s.sector} | **${s.count}** | ${s.maxBoard}板 | ${s.leaders.join('、') || '—'} |`).join('\n') +
      `\n\n> 板块效应判断：今日板块效应${sectorEffects.length >= 3 ? '明显，多主线并行' : '一般，主线分散'}，**${sectorEffects[0] ? sectorEffects[0].sector + '（' + sectorEffects[0].count + '家）' : '无明显强势板块'}** 领涨。`
    : '**有效板块（涨停 ≥3 家）**：无\n\n> 板块效应判断：今日无达到 3 家涨停的板块，赚钱效应集中在个股层面。';

  let sec4 = boards.length
    ? '**高度板梯队**：\n\n' +
      boards.map(b => {
        const t = `| ${b.board}板 | ${b.rows.map(r => `${r.name} ${r.code}（${r.type}）`).join('、')} | ${b.rows[0].sector} |`;
        return t;
      }).join('\n') +
      `\n\n> 龙头判断：最高 **${maxBoard} 板**，连板 **${chainCount} 家**。${chainCount >= 15 ? '连板梯队完整，情绪承接良好' : chainCount >= 8 ? '连板梯队一般，市场有承接但高度受限' : '连板梯队薄弱，情绪处于' + (limitUp < 30 ? '冰点' : '修复初期')}。`
    : '**高度板梯队**：无连板个股\n\n> 龙头判断：今日无 2 板以上个股，市场高度被压至 1 板，情绪冰点。';

  // sec4 追加昨日涨停表现
  if (yztPerf) {
    sec4 += `\n\n**昨日涨停今日表现**：**${yztPerf.avgPct >= 0 ? '+' : ''}${yztPerf.avgPct}%**（红盘率 ${yztPerf.redRate}%，大面 ${yztPerf.bigLossRate}%）——${yztPerf.avgPct > 0 ? '昨日打板者今日有溢价' : '昨日打板者今日亏损，谨慎接力'}。`;
  }

  const sec5 = `**行业板块合计**：主力净 **${totalIn >= 0 ? '+' : ''}${totalIn.toFixed(2)} 亿**（东财 60 行业板块资金合计口径）。

**当日净流入 Top5 板块**：

| 排名 | 板块 | 净流入（亿） | 涨跌幅 |
|---|---|---|---|
${inTop.map((x, i) => `| ${i + 1} | ${x.name} | **+${x.mainNet.toFixed(2)}** | ${x.pct >= 0 ? '+' : ''}${x.pct}% |`).join('\n')}

**当日净流出 Top5 板块**：

| 排名 | 板块 | 净流出（亿） | 涨跌幅 |
|---|---|---|---|
${outTop.map((x, i) => `| ${i + 1} | ${x.name} | **${x.mainNet.toFixed(2)}** | ${x.pct >= 0 ? '+' : ''}${x.pct}% |`).join('\n')}

**近5日资金趋势（扫描板块）**：

| 板块 | 5日资金(亿) | 20日资金(亿) | 趋势 |
|---|---|---|---|
${(lowRight.length ? lowRight.slice(0, 8) : fundList.sort((a, b) => b.mainNet - a.mainNet).slice(0, 8)).map(s => `| ${s.sector} | ${s.fund5 >= 0 ? '+' : ''}${s.fund5} | ${s.fund20 >= 0 ? '+' : ''}${s.fund20} | ${s.fundTrend || '—'} |`).join('\n')}

> 资金判断：${inTop[0] ? '**' + inTop[0].name + '** 净流入 ' + inTop[0].mainNet.toFixed(2) + ' 亿居首' : '资金面整体偏弱'}；${outTop[0] ? '**' + outTop[0].name + '** 净流出 ' + Math.abs(outTop[0].mainNet).toFixed(2) + ' 亿居前' : ''}。
> 口径标注：板块主力净流入来自东财 push2delay 板块资金流接口，与通达信 zjlx 个股口径近似，数值略有差异。`;

  const sec6 = lowRight.length
    ? `> 扫描范围：东财行业板块（资金 Top10 + 涨停效应板块），三重条件=低位（120日回撤≥15%）+资金（5日&20日净流入）+情绪（近5日涨停≥3家）。

**板块低位右侧扫描表**：

| 板块 | 120日回撤 | 20日涨幅 | 超额(vs沪深300) | 近5日涨停 | 5日资金(亿) | 20日资金(亿) | 资金趋势 | 通过条件 |
|---|---|---|---|---|---|---|---|---|
${lowRight.map(s => `| ${s.sector} | **${s.drawdown != null ? s.drawdown.toFixed(1) + '%' : '--'}** | ${s.pct20 != null ? (s.pct20 >= 0 ? '+' : '') + s.pct20.toFixed(1) + '%' : '--'} | ${s.excess20 != null ? (s.excess20 >= 0 ? '+' : '') + s.excess20.toFixed(1) + '%' : '--'} | ${s.zt5} | ${s.fund5 >= 0 ? '+' : ''}${s.fund5} | ${s.fund20 >= 0 ? '+' : ''}${s.fund20} | ${s.fundTrend || '—'} | ${s.pass.length ? s.pass.join('+') : '—'} |`).join('\n')}

> 机会判断：${(() => { const lv3 = lowRight.filter(s => s.level === 3); const lv2 = lowRight.filter(s => s.level === 2); if (lv3.length) return `**${lv3.map(s => s.sector).join('、')}** 三重共振（低位+资金+情绪），是唯一值得加入明日低吸候选池的方向`; if (lv2.length) return `**${lv2.map(s => s.sector).join('、')}** 通过两重条件（${lv2[0].pass.join('+')}），次选关注，等第三重确认`; return '**无板块通过三重条件**，市场暂无低位右侧共振方向，不参与'; })()}
> 口径标注：板块历史来自东财资金流日线接口（f62 收盘点位计算回撤/涨幅），与通达信 880/881 板块指数口径略有差异；近5日涨停为东财涨停池回溯口径。` 
    : (isAm
      ? `> 盘中快照（12:00）不做低位右侧历史扫描（需收盘后全量数据）。收盘正式版（16:00）将生成完整扫描表。`
      : `> 扫描范围：东财行业板块。**历史数据获取失败或扫描为空**，低位右侧判定以本地冰川复盘（通达信口径）为准。`);

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

  /* --- 龙虎榜机构数据（提前计算，供 LLM 与写文件共用） --- */
  const institutions = lhbList
    .filter(x => x.EXPLAIN && /机构/.test(x.EXPLAIN))
    .slice(0, 8)
    .map(x => ({
      name: x.SECURITY_NAME_ABBR, code: x.SECURITY_CODE,
      buy: +(x.BILLBOARD_BUY_AMT / 1e8).toFixed(2), net: +(x.BILLBOARD_NET_AMT / 1e8).toFixed(2),
      sector: (x.EXPLAIN || '').split('，')[0] || '', note: x.EXPLAIN || ''
    }));

  /* --- LLM 深度分析（配置 LLM_API_KEY / DEEPSEEK_API_KEY 时启用；失败自动回退规则模板） ---
     LLM 完成九段思考后，覆盖全部九段 + 生成候选池（含买点/止损/目标）与龙虎榜解读 */
  let llmPools = null;
  let llmLhbSummary = null;
  if (!isAm && LLM_API_KEY) {
    const llm = await llmAnalyze({
      date: td.date, idx, totalAmount, ud, ratio, sentiment,
      limitUp, limitDown, maxBoard, chainCount, yztPerf,
      inTop, outTop, sectorEffects, lowRight, lhbCount: lhbList.length,
      history: loadCapitalHistory(),
      lhbInst: institutions,
      lhbBroker: lhbBrokerages
    });
    if (llm) {
      // 覆盖全部九段（LLM 深度思考替代规则模板；保留数据段规则模板，LLM 段追加在其后）
      const secMap = { sec1: 0, sec2: 1, sec3: 2, sec4: 3, sec5: 4, sec6: 5, sec7: 6, sec8: 7, sec9: 8 };
      Object.entries(secMap).forEach(([k, i]) => {
        if (llm[k] && typeof llm[k] === 'string' && llm[k].trim()) {
          sections[i] = { title: sections[i].title, content: sections[i].content + '\n\n### ✨ AI 深度分析\n' + llm[k].trim() };
        }
      });
      if (Array.isArray(llm.pools) && llm.pools.length) llmPools = llm.pools;
      if (Array.isArray(llm.lhb_summary) && llm.lhb_summary.length) llmLhbSummary = llm.lhb_summary;
    }
  }

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

  // 5. sectors 低位右侧扫描表（新数据，前端可扩展展示）
  writeJson(`sectors/${td.date}.json`, {
    date: td.date, source: 'eastmoney-fflow-daykline',
    hs300pct20,
    note: '板块低位右侧扫描：120日回撤/20日涨幅/超额/近5日涨停/5日·20日资金。三重条件=低位+资金+情绪。',
    rows: lowRight
  });
  upsertIndex('sectors/index.json', { date: td.date });

  // 5.5 次日回头看存档（放弃条件追踪，跨日积累）
  if (lookback) {
    writeJson(`lookback/${td.date}.json`, {
      date: td.date, prevDate: lookback.prevDate,
      verdict: lookback.verdict,
      checks: lookback.checks
    });
    upsertIndex('lookback/index.json', { date: td.date });
  }

  // 6. pools 候选池（LLM 深度思考生成优先：含买点/止损/目标；否则规则占位）
  let poolRows = [];
  let poolNote = '来源：GitHub Actions 自动生成（低位右侧三重共振板块优先）。买点/止损/目标为占位，精修以本地冰川复盘为准。';
  if (llmPools && llmPools.length) {
    poolRows = llmPools.map(p => ({
      sector: p.sector || '', name: p.name || '', code: p.code || '—',
      buy: p.buy != null ? p.buy : null, stop: p.stop != null ? p.stop : null,
      target: p.target != null ? p.target : null, status: p.status || '观察中',
      note: p.note || ''
    }));
    poolNote = '来源：GitHub Actions + LLM 深度思考（完成九段复盘后生成，含买点/止损/目标，均为框架参考值，非投资建议）。';
  } else {
    const poolSectors = lowRight.filter(s => s.level >= 2).slice(0, 3);
    const poolFallback = poolSectors.length ? [] : inTop.slice(0, 3);
    (poolSectors.length ? poolSectors : poolFallback).forEach((s) => {
      const secName = s.sector || s.name;
      const leaders = ztList.filter(x => x.hybk === secName);
      const rep = leaders[0];
      const noteParts = [];
      if (s.level && s.pass) noteParts.push(`低位右侧：${s.pass.join('+')}（回撤${s.drawdown != null ? s.drawdown.toFixed(1) + '%' : '--'}，20日涨幅${s.pct20 != null ? s.pct20.toFixed(1) + '%' : '--'}，近5日涨停${s.zt5}家）`);
      if (s.fund20 != null) noteParts.push(`5日资金${s.fund5 >= 0 ? '+' : ''}${s.fund5}亿/20日${s.fund20 >= 0 ? '+' : ''}${s.fund20}亿`);
      if (!noteParts.length) noteParts.push(`主力净流入+${(s.mainNet || 0).toFixed(2)}亿（东财口径）`);
      poolRows.push({
        sector: secName,
        name: rep ? rep.name : (secName + '代表'),
        code: rep ? rep.code : '—',
        buy: null, stop: null, target: null, status: '观察中',
        note: noteParts.join('；') + '。买点/止损/目标需以本地精修复盘为准。'
      });
    });
  }
  writeJson(`pools/${td.date}.json`, {
    date: td.date,
    note: poolNote,
    pools: poolRows
  });
  upsertIndex('pools/index.json', { date: td.date });

  // 7. lhb 龙虎榜（席位明细 + 机构 + 拉萨 + LLM 解读）
  let lhbSummary = llmLhbSummary || [];
  if (!lhbSummary.length) {
    if (institutions.length) {
      lhbSummary.push(`机构净买入居前 **${institutions[0].name}**（+${institutions[0].net.toFixed(2)}亿）、**${institutions[1] ? institutions[1].name + '（+' + institutions[1].net.toFixed(2) + '亿）' : ''}**——机构龙虎榜合计净买 ${institutions.reduce((s, x) => s + x.net, 0).toFixed(2)} 亿（东财口径）`);
      lhbSummary.push(`上榜${lhbList.length}只，机构方向与当日强势板块${institutions[0] ? '（' + institutions[0].sector + '）' : ''}是否同源，需结合板块资金交叉验证`);
    }
    if (lhbBrokerages.length) {
      const known = lhbBrokerages.filter(b => b.alias);
      if (known.length) lhbSummary.push(`游资席位：${known.map(b => b.alias + '（' + b.today + '）').join('、')}——关注其买入方向是否与主线板块同源`);
    }
    if (!lhbSummary.length) lhbSummary.push('龙虎榜暂无机构净买入数据（东财接口当日无机构上榜或数据未更新）');
  }
  writeJson(`lhb/${td.date}.json`, {
    date: td.date,
    institutions,
    brokerages: lhbBrokerages,
    hotspots: [],
    summary: lhbSummary,
    lasa: lhbLasa,
    note: '来源：东财 datacenter RPT_DAILYBILLBOARD_DETAILSNEW + RPT_BILLBOARD_DAILYDETAILSBUY/SELL（云端自动）。游资名号为席位相似度推断（标注参考），精修以人工核实为准。'
  });
  upsertIndex('lhb/index.json', { date: td.date });

  // 8. views 保留
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
