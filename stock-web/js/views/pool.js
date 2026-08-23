/* ============================================================
   候选池跟踪视图
   - data/pools/<日期>.json：每日低吸候选池
   - 状态：观察中 / 已买入 / 已卖出 / 已放弃
   ============================================================ */
'use strict';

const PoolView = {
  title: '候选池跟踪',

  async render(el, params) {
    let list = [];
    try { list = await App.fetchJSON('data/pools/index.json'); } catch (e) { /* 忽略 */ }

    if (!list.length) {
      el.innerHTML = `<div class="section-title"><span class="num">🎯</span><h2>候选池跟踪</h2></div>
        <div class="card"><h2>暂无候选池记录</h2><p>复盘流程生成低吸候选池后，将在这里持续跟踪买入/止损/目标状态。</p></div>`;
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

    const rows = (data && data.pools) || [];
    const statusClass = s => ({ '观察中': 'flat', '已买入': 'up', '已卖出': 'flat', '已放弃': 'down' }[s] || 'flat');

    const table = rows.length ? `
      <div class="card">
        <h2>候选池 <span class="tag">${date}</span></h2>
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>板块</th><th>个股</th><th>代码</th><th>低吸买点</th><th>止损位</th><th>目标位</th><th>状态</th><th>备注</th></tr></thead>
            <tbody>
              ${rows.map(r => `
                <tr>
                  <td class="name">${App.esc(r.sector)}</td>
                  <td class="name">${App.esc(r.name)}</td>
                  <td>${App.esc(r.code || '')}</td>
                  <td>${r.buy != null ? App.esc(String(r.buy)) : '--'}</td>
                  <td class="down">${r.stop != null ? App.esc(String(r.stop)) : '--'}</td>
                  <td class="up">${r.target != null ? App.esc(String(r.target)) : '--'}</td>
                  <td><span class="chip ${statusClass(r.status)}"><b>${App.esc(r.status || '观察中')}</b></span></td>
                  <td style="text-align:left;color:var(--muted);font-size:12.5px">${App.esc(r.note || '')}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <p style="font-size:12px;color:var(--muted);margin-top:8px">买点/止损/目标为复盘时框架参考值，非交易指令。状态更新需在本地数据文件中维护（观察中→已买入→已卖出/已放弃）。</p>
      </div>` : '<div class="card"><h2>该日暂无候选池</h2></div>';

    const poolMeta = data && data.note ? `<div class="card" style="font-size:13px;color:var(--muted)">${App.esc(data.note)}</div>` : '';

    el.innerHTML = `
      <div class="section-title"><span class="num">🎯</span><h2>候选池跟踪</h2></div>
      ${dateBar}
      ${table}
      ${poolMeta}
      <div class="card" style="font-size:13px;color:var(--muted)">
        仓位纪律：单股 ≤10%，板块 ≤15%，总仓位 ≤50%（半仓上限，永不梭哈）。候选池跟踪的是"低吸"思路，追高打板不在本表范围。
      </div>`;

    el.querySelectorAll('[data-date]').forEach(b => b.addEventListener('click', () => {
      location.hash = '#/pool/' + b.dataset.date;
    }));
    App.stamp(`候选池 ${date}`);
  }
};

App.register('pool', PoolView);
