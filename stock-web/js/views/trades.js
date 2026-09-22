/* ============================================================
   每日交易记录表视图
   - data/trades/trades.json：交易记录（用户手动维护，14 字段）
   - data/trades/analysis_<date>.json：LLM 严谨复盘分析（脚本生成）
   - 统计：胜率/止损率/止盈率/市场背景×买点类型交叉/主线偏离/持股时长
   ============================================================ */
'use strict';

const TradesView = {
  title: '每日交易记录',

  /* ---------- 统计计算 ---------- */
  computeStats(trades) {
    const s = {
      total: trades.length,
      win: 0, lose: 0,        // 按 result 或收益率
      winByRet: 0, loseByRet: 0,
      stopLoss: 0, takeProfit: 0,
      mainline: 0, offMainline: 0,
      mainlineWin: 0, offMainlineWin: 0,
      avgReturn: 0, avgHold: 0,
      winReturns: [], loseReturns: [],
      byBg: {},        // 市场背景 → {n, win, returns:[]}
      byBuyType: {},   // 买点类型 → {n, win, returns:[]}
      bySellType: {},  // 卖点类型 → {n}
      disciplineBreak: 0,   // 违反体系失败
      normalLoss: 0,        // 体系内正常亏损
      luckWin: 0, systemWin: 0
    };
    trades.forEach(t => {
      const r = t.return_pct;
      const isWin = t.result === '成功' || r > 0;
      if (isWin) { s.win++; s.winReturns.push(r); } else { s.lose++; s.loseReturns.push(r); }
      if (r > 0) s.winByRet++; else if (r < 0) s.loseByRet++;

      if (t.sell_reason === '止损' || (t.sell_reason || '').includes('止损')) s.stopLoss++;
      else s.takeProfit++;

      if (t.is_mainline) { s.mainline++; if (isWin) s.mainlineWin++; }
      else { s.offMainline++; if (isWin) s.offMainlineWin++; }

      // 市场背景分组
      const bg = t.market_bg || '未知';
      s.byBg[bg] = s.byBg[bg] || { n: 0, win: 0, returns: [] };
      s.byBg[bg].n++; if (isWin) s.byBg[bg].win++;
      s.byBg[bg].returns.push(r);

      // 买点类型分组
      const bt = t.buy_type || '未知';
      s.byBuyType[bt] = s.byBuyType[bt] || { n: 0, win: 0, returns: [] };
      s.byBuyType[bt].n++; if (isWin) s.byBuyType[bt].win++;
      s.byBuyType[bt].returns.push(r);

      // 卖点类型
      const st = t.sell_type || '未知';
      s.bySellType[st] = (s.bySellType[st] || 0) + 1;

      // 归因
      const rr = t.result_reason || '';
      if (rr.includes('违反')) s.disciplineBreak++;
      if (rr.includes('正常亏损')) s.normalLoss++;
      if (rr.includes('运气')) s.luckWin++;
      if (rr.includes('按章作业')) s.systemWin++;

      s.avgHold += (t.hold_days || 0);
    });
    s.avgReturn = s.total ? +(s.winReturns.concat(s.loseReturns).reduce((a, b) => a + b, 0) / s.total).toFixed(2) : 0;
    s.winRate = s.total ? +(s.win / s.total * 100).toFixed(1) : 0;
    s.avgHold = s.total ? +(s.avgHold / s.total).toFixed(1) : 0;
    const avgW = s.winReturns.length ? s.winReturns.reduce((a, b) => a + b, 0) / s.winReturns.length : 0;
    const avgL = s.loseReturns.length ? Math.abs(s.loseReturns.reduce((a, b) => a + b, 0) / s.loseReturns.length) : 0;
    s.profitLossRatio = avgL > 0 ? +(avgW / avgL).toFixed(2) : (avgW > 0 ? 99 : 0);
    s.stopLossRate = s.total ? +(s.stopLoss / s.total * 100).toFixed(1) : 0;
    s.takeProfitRate = s.total ? +(s.takeProfit / s.total * 100).toFixed(1) : 0;
    return s;
  },

  /* ---------- 渲染 ---------- */
  async render(el, params) {
    let data = null;
    try { data = await App.fetchJSON('data/trades/trades.json'); } catch (e) { data = null; }

    if (!data || !data.trades || !data.trades.length) {
      el.innerHTML = `<div class="section-title"><span class="num">📒</span><h2>每日交易记录</h2></div>
        <div class="card"><h2>暂无交易记录</h2>
        <p style="font-size:13px;color:var(--muted)">在 <code>data/trades/trades.json</code> 中录入你的真实交易（14 字段见 README），此处将展示记录表 + 统计 + LLM 严谨复盘分析。</p></div>`;
      App.stamp('');
      return;
    }

    const trades = data.trades;
    const stats = this.computeStats(trades);

    // 尝试读取 LLM 分析（若有对应日期的分析文件，取最新的）
    let analysis = null;
    if (data.analysis) {
      analysis = data.analysis;
    } else {
      try {
        const idx = await App.fetchJSON('data/trades/index.json');
        const dates = Array.isArray(idx) ? idx.map(x => x.date) : [];
        for (let i = dates.length - 1; i >= 0; i--) {
          try {
            const a = await App.fetchJSON(`data/trades/analysis_${dates[i]}.json`);
            if (a && a.per_trade && a.per_trade.length) { analysis = a; break; }
          } catch (e) { /* 继续找 */ }
        }
      } catch (e) { /* 无分析 */ }
    }

    /* ---------- 记录表 ---------- */
    const rows = trades.map((t, i) => `
      <tr>
        <td class="name">${App.esc(t.stock)}${t.code ? '<br><span style="font-size:11px;color:var(--muted)">' + App.esc(t.code) + '</span>' : ''}</td>
        <td><span class="chip ${App.sentimentClass(t.market_bg)}"><b>${App.esc(t.market_bg || '--')}</b></span></td>
        <td style="font-size:12px">${App.esc(t.buy_time || '')}</td>
        <td class="${App.colorClass(t.buy_price != null && t.sell_price != null ? t.sell_price - t.buy_price : 0)}" style="font-weight:700">${t.buy_price != null ? t.buy_price.toFixed(2) : '--'}</td>
        <td><span class="chip flat"><b>${App.esc(t.buy_type || '--')}</b></span></td>
        <td style="text-align:left;font-size:12px;max-width:220px">${App.esc(t.buy_logic || '')}${t.is_mainline ? '<br><span class="up" style="font-weight:700">✔ 主线</span>' : '<br><span class="down">✘ 非主线</span>'}</td>
        <td style="font-size:12px">${App.esc(t.sell_time || '')}</td>
        <td class="${App.colorClass(t.return_pct)}" style="font-weight:800">${App.fmtPct(t.return_pct)}</td>
        <td><span class="chip ${t.sell_reason && t.sell_reason.includes('止损') ? 'down' : 'up'}"><b>${App.esc(t.sell_reason || '--')}</b></span><br><span style="font-size:11px;color:var(--muted)">${App.esc(t.sell_type || '')}</span></td>
        <td>${t.hold_days != null ? t.hold_days + '天' : '--'}</td>
        <td><span class="chip ${t.result === '成功' ? 'up' : 'down'}"><b>${App.esc(t.result || '--')}</b></span><br><span style="font-size:11px">${App.esc(t.result_reason || '')}</span></td>
        <td style="text-align:left;font-size:12px;color:var(--muted);max-width:240px">${App.esc(t.note || '')}</td>
      </tr>`).join('');

    /* ---------- 统计卡 ---------- */
    const bgRows = Object.entries(stats.byBg).map(([bg, v]) => {
      const wr = v.n ? +(v.win / v.n * 100).toFixed(1) : 0;
      const avg = v.returns.length ? +(v.returns.reduce((a, b) => a + b, 0) / v.returns.length).toFixed(2) : 0;
      return `<tr><td><span class="chip ${App.sentimentClass(bg)}">${App.esc(bg)}</span></td><td>${v.n}笔</td><td class="${App.colorClass(wr - 50)}" style="font-weight:700">${wr}%</td><td class="${App.colorClass(avg)}">${App.fmtPct(avg)}</td></tr>`;
    }).join('');

    const btRows = Object.entries(stats.byBuyType).map(([bt, v]) => {
      const wr = v.n ? +(v.win / v.n * 100).toFixed(1) : 0;
      const avg = v.returns.length ? +(v.returns.reduce((a, b) => a + b, 0) / v.returns.length).toFixed(2) : 0;
      return `<tr><td>${App.esc(bt)}</td><td>${v.n}笔</td><td class="${App.colorClass(wr - 50)}" style="font-weight:700">${wr}%</td><td class="${App.colorClass(avg)}">${App.fmtPct(avg)}</td></tr>`;
    }).join('');

    const sellRows = Object.entries(stats.bySellType).map(([st, n]) => `<tr><td>${App.esc(st)}</td><td>${n}笔</td><td>${(n / stats.total * 100).toFixed(0)}%</td></tr>`).join('');

    // 市场背景 × 买点类型 交叉表（严谨分析核心）
    const cross = {};
    trades.forEach(t => {
      const key = (t.market_bg || '未知') + '×' + (t.buy_type || '未知');
      cross[key] = cross[key] || { n: 0, win: 0 };
      cross[key].n++;
      if (t.result === '成功' || t.return_pct > 0) cross[key].win++;
    });
    const crossRows = Object.entries(cross).map(([k, v]) => {
      const [bg, bt] = k.split('×');
      const wr = +(v.win / v.n * 100).toFixed(0);
      const bad = (bg.includes('弱势') || bg === '冰点' || bg === '退潮') && bt === '突破';
      return `<tr>
        <td><span class="chip ${App.sentimentClass(bg)}">${App.esc(bg)}</span> × ${App.esc(bt)}</td>
        <td>${v.n}笔</td>
        <td class="${App.colorClass(wr - 50)}" style="font-weight:800">${wr}%</td>
        <td>${bad ? '<span class="down" style="font-weight:700">⚠️ 弱势买突破（体系禁忌）</span>' : '—'}</td>
      </tr>`;
    }).join('');

    const kpi = (label, val, cls, sub) => `
      <div class="kpi"><div class="label">${label}</div><div class="value ${cls || ''}">${val}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;

    /* ---------- LLM 分析区块 ---------- */
    let analysisHtml = '';
    if (analysis) {
      const perTrade = (analysis.per_trade || []).map(a => `
        <div class="review-section" style="border-left:3px solid var(--accent-teal)">
          <h3 style="font-family:var(--font-body);font-size:14.5px;font-weight:600;margin:0 0 8px;color:var(--ink)">${App.esc(a.stock)}${a.sector ? ' · ' + App.esc(a.sector) : ''}</h3>
          ${this.analysisItem('市场背景×买点匹配', a.market_bg_match)}
          ${this.analysisItem('买入点复盘', a.buy_point_review)}
          ${this.analysisItem('止损点跟踪（板块位置验证）', a.stop_loss_review)}
          ${this.analysisItem('卖点类型复盘', a.sell_review)}
          ${this.analysisItem('知行合一', a.discipline)}
          ${this.analysisItem('成败归因', a.attribution)}
          ${this.analysisItem('改进建议', a.improve)}
        </div>`).join('');
      const overall = analysis.overall || {};
      analysisHtml = `
        <div class="card" style="border:1px solid var(--accent-teal);background:linear-gradient(180deg,#f6fbf8,#faf9f5)">
          <h2>🤖 LLM 严谨复盘 <span class="tag">DeepSeek 深度分析</span></h2>
          ${this.analysisItem('整体交易模式', overall.pattern)}
          ${this.analysisItem('时机质量（是否总在不利时机强行交易）', overall.timing_issue)}
          ${this.analysisItem('主线偏离度', overall.mainline_deviation)}
          ${this.analysisItem('止损/买入点纪律核验', overall.stop_buy_discipline)}
          ${this.analysisItem('下一步改进清单', overall.next_actions)}
          <p style="font-size:12px;color:var(--muted);margin-top:10px">分析由 LLM 基于交易记录 + 当日真实行情生成，仅作复盘参考，不构成投资建议。</p>
        </div>
        <div style="display:flex;flex-direction:column;gap:12px;margin-top:12px">${perTrade}</div>`;
    }

    el.innerHTML = `
      <div class="section-title"><span class="num">📒</span><h2>每日交易记录</h2></div>

      <div class="kpi-row">
        ${kpi('总交易', stats.total + ' 笔', '')}
        ${kpi('胜率', stats.winRate + '%', stats.winRate >= 50 ? 'up' : 'down', '成功 ' + stats.win + ' / 失败 ' + stats.lose)}
        ${kpi('平均收益', App.fmtPct(stats.avgReturn), App.colorClass(stats.avgReturn), '盈亏比 ' + stats.profitLossRatio)}
        ${kpi('止损率', stats.stopLossRate + '%', stats.stopLossRate > 40 ? 'down' : '', '止盈率 ' + stats.takeProfitRate + '%')}
        ${kpi('平均持股', stats.avgHold + ' 天', '')}
      </div>

      <div class="card">
        <h2>交易明细 <span class="tag">${stats.total} 笔</span></h2>
        <div class="table-wrap">
          <table class="data">
            <thead><tr>
              <th>证券</th><th>市场背景</th><th>买入时间</th><th>买价</th><th>买点类型</th><th>买入逻辑/主线</th>
              <th>卖出时间</th><th>收益率</th><th>卖出原因/卖点</th><th>持股</th><th>结果/归因</th><th>备注</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <h2>📊 市场背景 × 胜率 <span class="tag">最佳交易时机分析</span></h2>
        <div class="table-wrap"><table class="data"><thead><tr><th>市场背景</th><th>笔数</th><th>胜率</th><th>平均收益</th></tr></thead><tbody>${bgRows}</tbody></table></div>
        <p style="font-size:12px;color:var(--muted);margin-top:8px">若弱势/冰点市场胜率显著低于强势/修复市场 → 说明你在不利时机强行交易，是亏损主因之一。</p>
      </div>

      <div class="card">
        <h2>🎯 市场背景 × 买点类型交叉 <span class="tag">体系匹配度核验</span></h2>
        <div class="table-wrap"><table class="data"><thead><tr><th>组合</th><th>笔数</th><th>胜率</th><th>体系判断</th></tr></thead><tbody>${crossRows}</tbody></table></div>
        <p style="font-size:12px;color:var(--muted);margin-top:8px">强势/修复市场可买突破；弱势/冰点市场应买回踩。若"弱势×突破"频繁出现且亏损 → 体系执行问题，非市场问题。</p>
      </div>

      <div class="card">
        <h2>🧭 买点类型 × 胜率</h2>
        <div class="table-wrap"><table class="data"><thead><tr><th>买点类型</th><th>笔数</th><th>胜率</th><th>平均收益</th></tr></thead><tbody>${btRows}</tbody></table></div>
      </div>

      <div class="card">
        <h2>🚪 卖点类型分布 <span class="tag">止盈率 ${stats.takeProfitRate}% / 止损率 ${stats.stopLossRate}%</span></h2>
        <div class="table-wrap"><table class="data"><thead><tr><th>卖点类型</th><th>笔数</th><th>占比</th></tr></thead><tbody>${sellRows}</tbody></table></div>
      </div>

      <div class="card">
        <h2>🧾 主线偏离分析</h2>
        <p style="font-size:14px;line-height:1.8">
          主线内交易：<b>${stats.mainline}</b> 笔（胜率 <b class="${App.colorClass(stats.mainlineWin / Math.max(1, stats.mainline) * 100 - 50)}">${stats.mainline ? (stats.mainlineWin / stats.mainline * 100).toFixed(1) : 0}%</b>）
          &nbsp;&nbsp;|&nbsp;&nbsp;
          非主线交易：<b>${stats.offMainline}</b> 笔（胜率 <b class="${App.colorClass(stats.offMainlineWin / Math.max(1, stats.offMainline) * 100 - 50)}">${stats.offMainline ? (stats.offMainlineWin / stats.offMainline * 100).toFixed(1) : 0}%</b>）
        </p>
        <p style="font-size:12.5px;color:var(--muted);margin-top:6px">归因统计：按章作业正反馈 ${stats.systemWin} 笔 / 运气获利 ${stats.luckWin} 笔 / 违反体系失败 ${stats.disciplineBreak} 笔 / 体系内正常亏损 ${stats.normalLoss} 笔。若"违反体系"占比高 → 纪律问题；若"体系内正常亏损"占比高 → 体系本身需校准。</p>
      </div>

      ${analysisHtml}

      <div class="card" style="font-size:12.5px;color:var(--muted)">
        📝 维护方式：编辑 <code>data/trades/trades.json</code> 追加交易记录；运行 <code>scripts/analyze_trades.js</code> 调用 LLM 生成严谨复盘（含板块止损/买入点跟踪）。示例数据仅供演示，请替换为真实记录。
      </div>`;

    App.stamp(`交易记录 ${stats.total} 笔 · 胜率 ${stats.winRate}%`);
  },

  analysisItem(label, text) {
    if (!text) return '';
    return `<div style="margin:8px 0;padding-left:12px;border-left:2px solid #e0d8cf">
      <div style="font-size:12px;font-weight:700;color:var(--accent-teal);margin-bottom:2px">${App.esc(label)}</div>
      <div style="font-size:13.5px;line-height:1.75;color:var(--ink)">${App.mdToHtmlColored(text)}</div>
    </div>`;
  }
};

App.register('trades', TradesView);
