#!/usr/bin/env node
/* ============================================================
   交易记录 LLM 严谨复盘分析（scripts/analyze_trades.js）
   ------------------------------------------------------------
   输入：data/trades/trades.json（用户维护）+ data/reviews/<date>.json 当日行情
   输出：data/trades/analysis_<date>.json（每笔交易的严谨复盘 + 整体交易模式）
   严谨要求：
   - 严格基于真实数据，禁止编造
   - 逐笔分析：市场背景×买点匹配、买入点、止损点（结合板块位置）、卖点类型、知行合一、归因
   - 整体分析：时机质量、是否总在不利时机强行交易、主线偏离度
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TRADES_PATH = path.join(ROOT, 'data/trades/trades.json');
const REVIEWS_DIR = path.join(ROOT, 'data/reviews');
const OUT_DIR = path.join(ROOT, 'data/trades');

const DEEPSEEK_API_KEY = process.env.LLM_API_KEY || process.env.DEEPSEEK_API_KEY || '';
const DEEPSEEK_BASE_URL = process.env.LLM_BASE_URL || 'https://api.deepseek.com/chat/completions';
const DEEPSEEK_MODEL = process.env.LLM_MODEL || 'deepseek-v4-flash';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchJSON(url, referer = 'https://quote.eastmoney.com/') {
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Referer: referer } });
  return r.json();
}

async function getMarketContext(dateStr) {
  // 拉取当日复盘 JSON 中的市场背景/情绪/板块数据
  const reviewPath = path.join(REVIEWS_DIR, `${dateStr}.json`);
  if (!fs.existsSync(reviewPath)) return null;
  try { return JSON.parse(fs.readFileSync(reviewPath, 'utf8')); } catch (e) { return null; }
}

async function getStockPrice(code) {
  // 腾讯实时行情：sh/sz/bj 前缀
  if (!code) return null;
  const c = String(code).padStart(6, '0');
  const prefix = c.startsWith('6') || c.startsWith('9') ? 'sh' : (c.startsWith('4') || c.startsWith('8') ? 'bj' : 'sz');
  try {
    const r = await fetch(`https://qt.gtimg.cn/q=${prefix}${c}`);
    const buf = await r.arrayBuffer();
    const text = new TextDecoder('gbk').decode(buf);
    const m = text.match(/v_[^=]+="([^"]+)"/);
    if (!m) return null;
    const f = m[1].split('~');
    return {
      name: f[1],
      price: parseFloat(f[3]),
      prevClose: parseFloat(f[4]),
      pct: f[4] ? +((f[3] - f[4]) / f[4] * 100).toFixed(2) : 0,
      high: parseFloat(f[33]),
      low: parseFloat(f[34]),
      volume: parseFloat(f[6])
    };
  } catch (e) { return null; }
}

async function callLLM(prompt) {
  if (!DEEPSEEK_API_KEY) return null;
  const body = {
    model: DEEPSEEK_MODEL,
    messages: [
      { role: 'system', content: '你是资深A股短线复盘分析师（爱在冰川框架+金融风控红线）。输出必须严格基于给定数据，禁止编造任何数字、个股、原因。结论要严谨、谨慎、可追溯。止损/买入点的判断必须结合板块历史位置和资金数据。每笔交易必须从7个维度独立分析（市场背景×买点匹配/买入点/止损点/卖点/知行合一/归因/改进），整体必须从5个维度总结。' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.3,
    max_tokens: 4000
  };
  if (/deepseek/.test(DEEPSEEK_MODEL)) {
    body.reasoning_effort = 'high';
    body.thinking = { type: 'enabled' };
  }
  try {
    const r = await fetch(DEEPSEEK_BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + DEEPSEEK_API_KEY },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180000)
    });
    if (!r.ok) throw new Error('LLM HTTP ' + r.status);
    const j = await r.json();
    const txt = j.choices && j.choices[0] && j.choices[0].message ? j.choices[0].message.content : '';
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('LLM 返回非 JSON');
    return JSON.parse(m[0]);
  } catch (e) {
    console.error('  ⚠️ LLM 失败:', e.message);
    return null;
  }
}

function formatTrade(t, market) {
  return `【单笔 #${t.id || ''}】${t.stock}(${t.code || '?'}) · ${t.sector || '?'}
- 市场背景：${t.market_bg}（${t.market_note || ''}）
- 买入：${t.buy_time} @ ¥${t.buy_price} · 买点类型=${t.buy_type} · 主线=${t.is_mainline ? '是' : '否'}
- 买入逻辑：${t.buy_logic}
- 卖出：${t.sell_time} @ ¥${t.sell_price} · 卖出原因=${t.sell_reason} · 卖点类型=${t.sell_type}
- 收益：${t.return_pct}% · 持股${t.hold_days}天 · 结果=${t.result} · 归因=${t.result_reason}
- 备注：${t.note || ''}`;
}

function buildPrompt(trades, market, prices) {
  const marketBlock = market ? `【当日市场背景（${market.date}）】
- 情绪档位：${market.sentiment} · 涨停${market.limitUp}/跌停${market.limitDown} · 最高${market.maxBoard}板
- 指数：${JSON.stringify(market.idx || {})}
- 资金：${JSON.stringify(market.snapshot || {})}
- 涉及板块当日表现：${(market.sections || []).map(s => s.title).join(' / ')}` : '【当日市场背景】无';

  const priceBlock = prices.length ? `【个股实时行情（截至最近交易日）】
${prices.map(p => p ? `${p.name} 现价¥${p.price} 涨跌${p.pct}%` : 'N/A').join('\n')}` : '';

  return `请对以下交易记录做严谨复盘分析，**严格基于给定数据，禁止编造任何数字/个股/原因**。

${marketBlock}

${priceBlock}

【交易记录（${trades.length} 笔）】
${trades.map((t, i) => formatTrade(t, market)).join('\n\n')}

请按以下结构以 JSON 返回（不要 markdown 代码块）：

{
  "date": "${market ? market.date : trades[0].buy_time.slice(0,10)}",
  "per_trade": [
    {
      "stock": "证券名",
      "sector": "板块",
      "market_bg_match": "市场背景与买点类型是否匹配（强势可买突破、修复可低吸、弱势/冰点应等回踩或空仓）。若不匹配明确指出，引用交易数据。",
      "buy_point_review": "买入点是否合理（结合板块位置+资金方向）。若是突破买点：是否在板块回踩或顶部？若是回踩：是否在支撑位？",
      "stop_loss_review": "止损点设置是否合理（典型-3%~-5%）。结合板块当日走势判断是否被触及或应被触及。是否过紧/过松？",
      "sell_review": "卖点类型是否合理（左侧加速/右侧逆转/破位止损）。左侧止盈是主动还是被动？右侧止盈是确认破位后离场吗？止损是否执行纪律？",
      "discipline": "知行合一评估：买入时是否按体系（市场背景×买点匹配）？卖出时是否按纪律（止损线/卖点信号）？",
      "attribution": "成败归因：若成功是按章作业正反馈（体系正确+执行到位），还是运气（即便错误也赚钱）？若失败是违反体系（错误市场+错误买点），还是体系内正常亏损（正确但市场不给力）？严格区分。",
      "improve": "针对这笔交易的具体改进建议（不超过60字）"
    }
  ],
  "overall": {
    "pattern": "整体交易模式分析（如：高频追突破/低频低吸/止损纪律强弱/平均持仓周期）",
    "timing_issue": "时机质量：是否总在弱势/冰点市场强行交易？若强势/修复市场胜率显著高于弱势/冰点市场，明确指出这是亏损主因之一。",
    "mainline_deviation": "主线偏离度：是否频繁在非主线方向交易？主线内胜率vs非主线胜率差异如何？是否应严格只做主线？",
    "stop_buy_discipline": "止损/买入点纪律核验：止损率是否合理（<40%）？买点类型与市场背景匹配度？是否存在反复犯同样错误？",
    "next_actions": "下周/下阶段3-5条具体改进清单（按优先级）"
  }
}`;
}

async function main() {
  const argDate = process.argv.find(a => a.startsWith('--date='));
  const targetDate = argDate ? argDate.split('=')[1] : null;

  if (!fs.existsSync(TRADES_PATH)) {
    console.error('❌ 未找到', TRADES_PATH);
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(TRADES_PATH, 'utf8'));
  const trades = data.trades || [];
  if (!trades.length) {
    console.log('无交易记录，跳过');
    return;
  }

  // 确定分析日期：取最近一笔交易日期，或命令行指定
  const date = targetDate || (trades[trades.length - 1].sell_time || trades[trades.length - 1].buy_time || '').slice(0, 10);
  if (!date) {
    console.error('❌ 无法确定分析日期');
    process.exit(1);
  }

  console.log('📊 严谨复盘分析：', date, '| 交易笔数：', trades.length);

  // 拉取市场背景 + 个股实时行情
  const market = await getMarketContext(date);
  if (market) console.log('  ✓ 当日市场背景已加载（情绪', market.sentiment, '）');
  else console.log('  ⚠️ 未找到当日复盘 JSON（', date, '）');

  // 拉取个股实时行情（为 LLM 提供当下价格参考）
  const prices = [];
  for (const t of trades) {
    const p = await getStockPrice(t.code);
    prices.push(p);
    if (p) console.log('  ✓ ' + p.name + ' 现价¥' + p.price);
    await sleep(200);
  }

  // 调用 LLM
  if (!DEEPSEEK_API_KEY) {
    console.log('  ⚠️ 未配置 LLM_API_KEY / DEEPSEEK_API_KEY，跳过分析生成');
    return;
  }
  const prompt = buildPrompt(trades, market, prices);
  console.log('  🤖 调用 LLM...');
  const analysis = await callLLM(prompt);
  if (!analysis) {
    console.log('  ❌ LLM 分析失败');
    return;
  }

  // 写文件
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = { ...analysis, generated_at: new Date().toISOString(), source: 'DeepSeek 严谨复盘' };
  const outPath = path.join(OUT_DIR, `analysis_${date}.json`);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
  console.log('  ✅ 分析已写入:', outPath);
}

// 导出函数供测试 / 模块调用，同时保留 CLI 入口
module.exports = { getStockPrice, getMarketContext, buildPrompt, callLLM, main };

if (require.main === module) {
  main().catch(e => { console.error('Fatal:', e); process.exit(1); });
}
