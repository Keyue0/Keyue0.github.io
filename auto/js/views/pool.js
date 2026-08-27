/* ============================================================
   候选池跟踪视图（模拟实盘持仓账本）
   - data/pools/<日期>.json：每日 LLM 推荐的候选池（买入价/止损/目标）
   - data/pools/positions.json：持仓账本（推荐→买入→持有→止损/止盈→卖出显示收益率）
   ============================================================ */
'use strict';

const PoolView = {
  title: '候选池跟踪',

  async render(el, params) {
    let list = [];
    try { list = await App.fetchJSON('data/pools/index.json'); } catch (e) { /* 忽略 */ }

    if (!list.length) {
      el.innerHTML = `<div class="section-title"><span class="num">🎯</span><h2>候选池跟踪</h2></div>
        <div class="card"><h2>暂无候选池记录</h2><p>复盘流程（LLM）生成候选池后，将在这里持续跟踪买入/止损/目标，直到卖出显示收益率。</p></div>`;
      App.stamp('');
      return;
    }

    const date = params[0] || list[0].date;
    let data;
    try { data = await App.fetchJSON(`data/pools/${date}.json`); } catch (e) { data = null; }

    const dateBar = `
      <div class="controls"><div class="group"><span class="glabel">候选池日期</span>
      ${list.map(r => `<button class="btn ${r.date === date ? 'active' : ''}" data-date="${App.esc(r.date)}">${App.esc(r.date)}</button>`).join('')}
      </div></div>`;

    /* ---------- 1. 当日候选池（LLM 推荐：买入价/止损/目标） ---------- */
    const rows = (data && data.pools) || [];
    const table = rows.length ? `
      <div class="card">
        <h2>🎯 当日候选池 <span class="tag">${date} · LLM 推荐</span></h2>
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>板块</th><th>个股</th><th>代码</th><th>买入价</th><th>止损</th><th>目标</th><th>推荐逻辑</th></tr></thead>
            <tbody>
              ${rows.map(r => `
                <tr>
                  <td class="name">${App.esc(r.sector)}</td>
                  <td class="name">${App.esc(r.name)}</td>
                  <td>${App.esc(r.code || '')}</td>
                  <td style="font-weight:700">${r.buy != null ? r.buy : '--'}</td>
                  <td class="down" style="font-weight:700">${r.stop != null ? r.stop : '--'}</td>
                  <td class="up" style="font-weight:700">${r.target != null ? r.target : '--'}</td>
                  <td style="text-align:left;color:var(--muted);font-size:12.5px;max-width:320px">${App.esc(r.note || '')}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <p style="font-size:12px;color:var(--muted);margin-top:8px">买入价/止损/目标为 LLM 基于真实行情推算的框架参考值（止损-3%~-5%，目标+8%~+15%），非交易指令。</p>
      </div>` : '<div class="card"><h2>该日暂无候选池</h2><p style="font-size:13px;color:var(--muted)">LLM 未生成候选池（可能当日无符合条件的真实个股，或 LLM 未配置/调用失败）。</p></div>';

    /* ---------- 2. 持仓账本（模拟实盘：持有中 + 已平仓 + 收益率） ---------- */
    let positionsHtml = '';
    try {
      const book = await App.fetchJSON('data/pools/positions.json');
      if (Array.isArray(book) && book.length) {
        const holding = book.filter(p => p.status === '持有中');
        const closed = book.filter(p => p.status !== '持有中');

        const statusChip = p => {
          const map = { '持有中': 'flat', '已止损': 'down', '已止盈': 'up', '到期平仓': 'flat' };
          return `<span class="chip ${map[p.status] || 'flat'}"><b>${App.esc(p.status)}</b></span>`;
        };

        const rowHtml = p => {
          const ret = p.return_pct != null ? p.return_pct : p.cur_pct;
          const retCls = App.colorClass(ret);
          return `<tr>
            <td class="name">${App.esc(p.name)}<br><span style="font-size:11px;color:var(--muted)">${App.esc(p.code || '')}</span></td>
            <td>${App.esc(p.sector || '')}</td>
            <td>${App.esc(p.rec_date || '')}</td>
            <td style="font-weight:700">${p.buy_price != null ? p.buy_price : '--'}</td>
            <td class="down">${p.stop != null ? p.stop : '--'}</td>
            <td class="up">${p.target != null ? p.target : '--'}</td>
            <td>${p.cur_price != null ? p.cur_price : (p.sell_price != null ? p.sell_price : '--')}</td>
            <td class="${retCls}" style="font-weight:800">${ret != null ? App.fmtPct(ret) : '--'}</td>
            <td>${p.days_held != null ? p.days_held + '天' : '--'}</td>
            <td>${statusChip(p)}</td>
            <td style="text-align:left;font-size:12px;color:var(--muted);max-width:240px">${App.esc(p.verdict || (p.status === '持有中' ? '持有中，未触发止损/目标' : ''))}</td>
          </tr>`;
        };

        const holdingHtml = holding.length ? `
          <div class="card" style="border:1px solid var(--accent-teal)">
            <h2>📊 持仓中 <span class="tag">${holding.length} 只</span></h2>
            <div class="table-wrap"><table class="data">
              <thead><tr><th>个股</th><th>板块</th><th>推荐日</th><th>买入价</th><th>止损</th><th>目标</th><th>现价</th><th>浮盈亏</th><th>持有</th><th>状态</th><th>说明</th></tr></thead>
              <tbody>${holding.map(rowHtml).join('')}</tbody>
            </table></div>
          </div>` : '';

        const closedHtml = closed.length ? `
          <div class="card">
            <h2>📉 已平仓（收益率） <span class="tag">${closed.length} 笔</span></h2>
            <div class="table-wrap"><table class="data">
              <thead><tr><th>个股</th><th>板块</th><th>推荐日</th><th>买入价</th><th>止损</th><th>目标</th><th>卖出价</th><th>收益率</th><th>持有</th><th>结果</th><th>说明</th></tr></thead>
              <tbody>${closed.map(rowHtml).join('')}</tbody>
            </table></div>
            ${(() => {
              const wins = closed.filter(p => (p.return_pct != null ? p.return_pct : 0) > 0).length;
              const avgRet = closed.length ? +(closed.reduce((s, p) => s + (p.return_pct || 0), 0) / closed.length).toFixed(2) : 0;
              const winRate = +(wins / closed.length * 100).toFixed(1);
              const stops = closed.filter(p => p.status === '已止损').length;
              const tps = closed.filter(p => p.status === '已止盈').length;
              return `<p style="font-size:13px;margin-top:10px;line-height:1.8">
                已平仓 <b>${closed.length}</b> 笔：止盈 <b class="up">${tps}</b> 笔 / 止损 <b class="down">${stops}</b> 笔 / 到期 <b>${closed.length - tps - stops}</b> 笔；
                胜率 <b class="${App.colorClass(winRate - 50)}">${winRate}%</b>，平均收益 <b class="${App.colorClass(avgRet)}">${App.fmtPct(avgRet)}</b>。
              </p>`;
            })()}
          </div>` : '';

        positionsHtml = holdingHtml + closedHtml;
      }
    } catch (e) { /* 无持仓账本 */ }

    const poolMeta = data && data.note ? `<div class="card" style="font-size:13px;color:var(--muted)">${App.esc(data.note)}</div>` : '';

    el.innerHTML = `
      <div class="section-title"><span class="num">🎯</span><h2>候选池跟踪</h2></div>
      ${dateBar}
      ${positionsHtml}
      ${table}
      ${poolMeta}
      <div class="card" style="font-size:13px;color:var(--muted)">
        模拟实盘规则：推荐日按收盘价买入，收盘价≤止损价→止损卖出，≥目标价→止盈卖出，持有5个交易日未触发→到期平仓。收益率均为真实行情回算（腾讯接口）。仓位纪律：单股≤10%，总仓位≤50%。框架化复盘/推演，不构成投资建议。
      </div>`;

    el.querySelectorAll('[data-date]').forEach(b => b.addEventListener('click', () => {
      location.hash = '#/pool/' + b.dataset.date;
    }));
    App.stamp(`候选池 ${date}`);
  }
};

App.register('pool', PoolView);
