#!/usr/bin/env node
/* ============================================================
   WorkBuddy 增强数据生成工具
   ------------------------------------------------------------
   作用：把通达信 MCP（tdx_kline）拉取的板块指数日K原始数据，
         转换成 auto/data/sectors/enhanced_<date>.json（通达信口径，
         比东财更准），fetch_data.js 检测到后优先使用。
   用法：
     1. 在 WorkBuddy 会话中：tdx_lookup_stock 查板块代码（如 000819 有色金属）
     2. tdx_kline(code=000819, setcode=1, period=4, wantNum=130)
     3. 把返回的 JSON 保存为 raw_kline/000819_2026-08-21.json
        （只保留 {code,name,date,Rows:[{Data,High,Close}]} 也行）
     4. node build_enhanced.js --date=2026-08-21
     5. 把生成的 data/sectors/enhanced_2026-08-21.json 随仓库推送
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const RAW = path.join(__dirname, 'raw_kline');
const OUT = path.join(ROOT, 'data', 'sectors');

function parseArgs() {
  const a = process.argv.slice(2);
  const get = k => { const x = a.find(v => v.startsWith('--' + k + '=')); return x ? x.split('=')[1] : null; };
  return { date: get('date'), sectorMap: get('sectors') };
}

/* 通达信 K 线原始 JSON → 计算回撤/涨幅 */
function calcFromTdx(j) {
  const rows = j.Rows || [];
  if (!rows.length) return null;
  const closes = rows.map(r => parseFloat(r.Close));
  const highs = rows.map(r => parseFloat(r.High));
  const last = closes[closes.length - 1];
  const hi120 = Math.max(...highs.slice(-120));
  const close20ago = closes[closes.length - 21];
  return {
    drawdown: last > 0 && hi120 > 0 ? +((last - hi120) / hi120 * 100).toFixed(2) : null,
    pct20: close20ago > 0 ? +((last - close20ago) / close20ago * 100).toFixed(2) : null,
    lastDate: rows[rows.length - 1].Data
  };
}

(async () => {
  const { date, sectorMap } = parseArgs();
  if (!date) { console.error('用法: node build_enhanced.js --date=YYYY-MM-DD [--sectors=代码:名称,代码:名称]'); process.exit(1); }

  const files = fs.readdirSync(RAW).filter(f => f.endsWith('.json'));
  if (!files.length) { console.error('raw_kline/ 下无 K 线文件，请先保存 tdx_kline 返回 JSON'); process.exit(1); }

  const map = {};
  if (sectorMap) sectorMap.split(',').forEach(p => { const [c, n] = p.split(':'); if (c && n) map[c] = n; });

  // 沪深300（超额基准）：文件名含 000300 或 sh000300 或 hs300
  let hs300pct20 = null;
  const hsFile = files.find(f => /000300|hs300/i.test(f));
  if (hsFile) {
    const j = JSON.parse(fs.readFileSync(path.join(RAW, hsFile), 'utf8'));
    const c = calcFromTdx(j);
    if (c) hs300pct20 = c.pct20;
  }

  const rows = [];
  for (const f of files) {
    if (hsFile === f) continue;
    const j = JSON.parse(fs.readFileSync(path.join(RAW, f), 'utf8'));
    const code = j.code || f.split('_')[0];
    const name = j.name || map[code] || code;
    const c = calcFromTdx(j);
    if (!c) { console.log('  ⚠️ 跳过 ' + f + '（无K线）'); continue; }
    const pass = [];
    if (c.drawdown != null && c.drawdown <= -15) pass.push('低位');
    // 资金条件需要 tdx 资金数据，此处仅 K 线 → 资金由东财自动版补或手动填
    rows.push({
      sector: name, code,
      drawdown: c.drawdown, pct20: c.pct20,
      excess20: c.pct20 != null && hs300pct20 != null ? +(c.pct20 - hs300pct20).toFixed(2) : null,
      zt5: 0, fund5: null, fund20: null, pass, level: pass.length,
      _klineDate: c.lastDate
    });
  }

  if (!rows.length) { console.error('没有可用的板块数据'); process.exit(1); }
  rows.sort((a, b) => b.level - a.level);

  fs.mkdirSync(OUT, { recursive: true });
  const outPath = path.join(OUT, `enhanced_${date}.json`);
  fs.writeFileSync(outPath, JSON.stringify({
    date, source: 'tdx-kline (WorkBuddy 通达信口径)',
    hs300pct20,
    note: '通达信板块指数 K 线计算（120日回撤/20日涨幅/超额）。资金与涨停条件由 fetch_data.js 自动版补充。',
    rows
  }, null, 2), 'utf8');
  console.log('✅ 增强数据已生成: ' + outPath);
  console.log('   覆盖板块: ' + rows.map(r => r.sector).join('、'));
  console.log('   沪深300近20日涨幅: ' + (hs300pct20 != null ? hs300pct20 + '%' : '未提供'));
  console.log('   ⚠️ 提醒: 将文件推送到仓库，fetch_data.js 会自动优先使用（通达信口径）');
})().catch(e => { console.error('❌ 失败:', e.message); process.exit(1); });
