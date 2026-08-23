/* ============================================================
   龙虎榜视图
   - data/lhb/<日期>.json：机构净买入 + 具名游资席位动向 + 盘面小结 + 拉萨天团
   ============================================================ */
'use strict';

const LhbView = {
  title: '龙虎榜',

  /* 知名游资名号 → 常见关联（市场约定俗成，标注参考） */
  HOT_FOCUS: ['北京知春路','学院南路','方新侠','宁波桑田路','章盟主','紫阳东路','小鳄鱼','作手新一','葛卫东','成都系','量化打板','深南东路','苏南帮','浙江帮','温州帮','低位挖掘'],

  async render(el, params) {
    let list = [];
    try { list = await App.fetchJSON('data/lhb/index.json'); } catch (e) { /* 忽略 */ }

    if (!list.length) {
      el.innerHTML = `<div class="section-title"><span class="num">🐉</span><h2>龙虎榜</h2></div>
        <div class="card"><h2>暂无龙虎榜数据</h2><p>复盘流程生成龙虎榜数据后展示（机构净买入 / 具名游资 / 盘面小结）。</p></div>`;
      App.stamp('');
      return;
    }

    const date = params[0] || list[0].date;
    let data;
    try { data = await App.fetchJSON(`data/lhb/${date}.json`); } catch (e) { data = null; }

    const dateBar = `
      <div class="controls"><div class="group"><span class="glabel">日期</span>
      ${list.map(r => `<button class="btn ${r.date === date ? 'active' : ''}" data-date="${App.esc(r.date)}">${App.esc(r.date)}</button>`).join('')}
      </div></div>`;

    // 机构净买入 Top（按 net 降序）
    const inst = (data && data.institutions) || [];
    const instHtml = inst.length ? `
      <div class="card">
        <h2>机构净买入居前 <span class="tag">单位：亿元</span></h2>
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>#</th><th>个股</th><th>代码</th><th>所属方向</th><th>机构买入</th><th>净买入</th><th>备注</th></tr></thead>
            <tbody>
              ${inst.slice().sort((a, b) => (b.net || 0) - (a.net || 0)).map((r, i) => `
                <tr>
                  <td class="rank">${i + 1}</td>
                  <td class="name">${App.esc(r.name)}</td>
                  <td>${App.esc(r.code || '')}</td>
                  <td style="text-align:left">${App.esc(r.sector || '')}</td>
                  <td class="up">${r.buy != null ? r.buy.toFixed(2) : '--'}</td>
                  <td class="up" style="font-weight:800">${r.net != null ? '+' + r.net.toFixed(2) : '--'}</td>
                  <td style="text-align:left;font-size:12px;color:#6c6a64">${App.esc(r.note || '')}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>` : '';

    // 具名游资席位动向
    const brokerages = (data && data.brokerages) || [];
    const brokeragesHtml = brokerages.length ? `
      <div class="card">
        <h2>知名游资席位动向 <span class="tag">${brokerages.length} 位</span></h2>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;margin-top:6px">
          ${brokerages.map(b => this.brokerageCard(b)).join('')}
        </div>
      </div>` : '';

    // 盘面资金小结
    const summary = (data && data.summary) || [];
    const summaryHtml = summary.length ? `
      <div class="card">
        <h2>盘面资金小结 <span class="tag">核心观察</span></h2>
        <div style="font-size:14px;line-height:1.85">
          ${summary.map(s => `<p style="margin:10px 0;padding-left:14px;border-left:3px solid #cc785c">${App.mdToHtmlColored(s)}</p>`).join('')}
        </div>
      </div>` : '';

    // 游资/通道方向（保留原 hotspots 段）
    const spots = (data && data.hotspots) || [];
    const spotsHtml = spots.length ? `
      <div class="card">
        <h2>游资 / 通道方向</h2>
        ${spots.map(s => `
          <div class="review-section" style="background:transparent;border:none;box-shadow:none;padding:0;margin-bottom:0">
            <h3 style="font-family:var(--font-body);font-size:14.5px;font-weight:600;margin:12px 0 6px;padding-left:12px;border-left:3px solid var(--accent-teal)">${App.esc(s.direction)}</h3>
            <p style="font-size:13.5px;color:#3d3d3a;line-height:1.7">${App.esc(s.desc)}</p>
          </div>`).join('')}
      </div>` : '';

    // 拉萨天团上榜个股
    const lasa = (data && data.lasa) || [];
    const lasaHtml = lasa.length ? `
      <div class="card">
        <h2>拉萨天团上榜个股 <span class="tag">${lasa.length} 只</span></h2>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">
          ${lasa.map(s => `<span class="chip" style="background:#fef3ed;color:#a9583e;font-weight:500">${App.esc(s)}</span>`).join('')}
        </div>
        <p style="font-size:12px;color:#6c6a64;margin-top:10px">拉萨东环路 / 拉萨团结路 系散户聚集席位，频繁上榜小盘高换手股。</p>
      </div>` : '';

    el.innerHTML = `
      <div class="section-title"><span class="num">🐉</span><h2>龙虎榜</h2></div>
      ${dateBar}
      ${instHtml}
      ${brokeragesHtml}
      ${summaryHtml}
      ${spotsHtml}
      ${lasaHtml}
      ${data && data.note ? `<div class="card" style="font-size:12.5px;color:#6c6a64;line-height:1.7">${App.esc(data.note)}</div>` : ''}`;

    el.querySelectorAll('[data-date]').forEach(b => b.addEventListener('click', () => {
      location.hash = '#/lhb/' + b.dataset.date;
    }));
    App.stamp(`龙虎榜 ${date}`);
  },

  brokerageCard(b) {
    const trades = b.trades || [];
    const buys = trades.filter(t => t.type === 'buy');
    const sells = trades.filter(t => t.type === 'sell');
    const buyTotal = buys.reduce((a, t) => a + (t.amount || 0), 0);
    const sellTotal = sells.reduce((a, t) => a + (t.amount || 0), 0);
    return `
      <div style="background:#faf9f5;border:1px solid #e6dfd8;border-radius:10px;padding:14px 16px">
        <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:6px;flex-wrap:wrap">
          <span style="font-size:15px;font-weight:700;color:#141413">${App.esc(b.name)}</span>
          ${b.today ? `<span style="font-size:12px;color:#6c6a64">${App.esc(b.today)}</span>` : ''}
        </div>
        <div style="font-size:11.5px;color:#8e8b82;margin-bottom:8px">${App.esc(b.seat || '')}</div>
        <div style="font-size:13px;line-height:1.6;margin-bottom:8px">
          ${trades.slice(0, 6).map(t => `
            <div style="display:flex;align-items:baseline;gap:6px;margin:3px 0;font-size:12.5px">
              <span style="min-width:24px;color:${t.type === 'buy' ? '#e02020' : '#00a854'};font-weight:700">${t.type === 'buy' ? '买' : '卖'}</span>
              <span style="color:#141413">${App.esc(t.stock)}</span>
              <span style="color:${t.type === 'buy' ? '#e02020' : '#00a854'};font-weight:600;margin-left:auto">${(t.amount || 0).toFixed(2)}亿</span>
              ${t.period ? `<span style="font-size:11px;color:#6c6a64">${App.esc(t.period)}</span>` : ''}
            </div>`).join('')}
        </div>
        <div style="display:flex;gap:10px;font-size:12px;padding-top:8px;border-top:1px dashed #e6dfd8">
          <span>买 <b class="up">${buyTotal.toFixed(2)}</b> 亿</span>
          <span>卖 <b class="down">${sellTotal.toFixed(2)}</b> 亿</span>
          <span style="color:${buyTotal > sellTotal ? '#e02020' : (sellTotal > buyTotal ? '#00a854' : '#6c6a64')};font-weight:700;margin-left:auto">净 ${(buyTotal - sellTotal > 0 ? '+' : '')}${(buyTotal - sellTotal).toFixed(2)}</span>
        </div>
        ${b.focus ? `<div style="font-size:12px;color:#3d3d3a;margin-top:8px;padding-top:8px;border-top:1px solid #f5f0e8">${App.esc(b.focus)}</div>` : ''}
      </div>`;
  }
};

App.register('lhb', LhbView);
