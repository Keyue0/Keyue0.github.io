/* ============================================================
   龙虎榜视图
   - data/lhb/<日期>.json：机构买入 + 游资/通道方向
   ============================================================ */
'use strict';

const LhbView = {
  title: '龙虎榜',

  async render(el, params) {
    let list = [];
    try { list = await App.fetchJSON('data/lhb/index.json'); } catch (e) { /* 忽略 */ }

    if (!list.length) {
      el.innerHTML = `<div class="section-title"><span class="num">🐉</span><h2>龙虎榜</h2></div>
        <div class="card"><h2>暂无龙虎榜数据</h2><p>复盘流程生成龙虎榜数据后展示（机构买入/游资方向）。</p></div>`;
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

    const inst = (data && data.institutions) || [];
    const instHtml = inst.length ? `
      <div class="card">
        <h2>机构买入居前 <span class="tag">单位：亿元</span></h2>
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>个股</th><th>代码</th><th>所属方向</th><th>机构买入</th><th>净买入</th></tr></thead>
            <tbody>
              ${inst.map(r => `<tr>
                <td class="name">${App.esc(r.name)}</td>
                <td>${App.esc(r.code || '')}</td>
                <td style="text-align:left">${App.esc(r.sector || '')}</td>
                <td class="up">${r.buy != null ? App.fmtYi(r.buy) : '--'}</td>
                <td class="${App.colorClass(r.net)}">${r.net != null ? App.fmtYi(r.net) : '--'}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>` : '';

    const spots = (data && data.hotspots) || [];
    const spotsHtml = spots.length ? `
      <div class="card">
        <h2>游资 / 通道方向</h2>
        ${spots.map(s => `
          <div class="review-section">
            <h3 style="font-size:14px;color:var(--text)">${App.esc(s.direction)}</h3>
            <p style="font-size:13.5px;color:#8b949e">${App.esc(s.desc)}</p>
          </div>`).join('')}
      </div>` : '';

    el.innerHTML = `
      <div class="section-title"><span class="num">🐉</span><h2>龙虎榜</h2></div>
      ${dateBar}
      ${instHtml}
      ${spotsHtml}
      ${data && data.note ? `<div class="card" style="font-size:13px;color:#8b949e">${App.esc(data.note)}</div>` : ''}
      <div class="card" style="font-size:12.5px;color:#8b949e">
        龙虎榜反映机构与游资的买卖动向（交易所披露），是验证板块资金方向的重要旁证。数据来自复盘流程（westock data_lhb 口径）。
      </div>`;

    el.querySelectorAll('[data-date]').forEach(b => b.addEventListener('click', () => {
      location.hash = '#/lhb/' + b.dataset.date;
    }));
    App.stamp(`龙虎榜 ${date}`);
  }
};

App.register('lhb', LhbView);
