/* ============================================================
   连板梯队视图
   - data/ladders/<日期>.json：连板梯队 + 隔板高标
   ============================================================ */
'use strict';

const LadderView = {
  title: '连板梯队',

  async render(el, params) {
    let list = [];
    try { list = await App.fetchJSON('data/ladders/index.json'); } catch (e) { /* 忽略 */ }

    if (!list.length) {
      el.innerHTML = `<div class="section-title"><span class="num">📶</span><h2>连板梯队</h2></div>
        <div class="card"><h2>暂无梯队数据</h2><p>复盘流程生成连板梯队数据后展示。</p></div>`;
      App.stamp('');
      return;
    }

    const date = params[0] || list[0].date;
    let data;
    try { data = await App.fetchJSON(`data/ladders/${date}.json`); } catch (e) { data = null; }

    const dateBar = `
      <div class="controls"><div class="group"><span class="glabel">日期</span>
      ${list.map(r => `<button class="btn ${r.date === date ? 'active' : ''}" data-date="${App.esc(r.date)}">${App.esc(r.date)}</button>`).join('')}
      </div></div>`;

    const meta = data && data.meta ? data.meta : {};
    const hero = `
      <div class="kpi-row">
        <div class="kpi"><div class="label">涨停家数</div><div class="value up">${meta.limitUp != null ? App.esc(meta.limitUp) : '--'}</div></div>
        <div class="kpi"><div class="label">跌停家数</div><div class="value down">${meta.limitDown != null ? App.esc(meta.limitDown) : '--'}</div></div>
        <div class="kpi"><div class="label">最高板</div><div class="value">${meta.maxBoard != null ? App.esc(meta.maxBoard) + ' 板' : '--'}</div></div>
        <div class="kpi"><div class="label">连板家数</div><div class="value">${meta.chainCount != null ? App.esc(meta.chainCount) : '--'}</div></div>
      </div>`;

    // 按板数分组的表格
    const boards = (data && data.boards) || [];
    const boardHtml = boards.map(b => {
      const rows = b.rows || [];
      return `
        <div class="card">
          <h2>${b.board} 连板 <span class="tag">${rows.length} 家</span></h2>
          <div class="table-wrap">
            <table class="data">
              <thead><tr><th>个股</th><th>代码</th><th>所属细分板块</th><th>板型</th></tr></thead>
              <tbody>
                ${rows.map(r => `<tr>
                  <td class="name">${App.esc(r.name)}</td>
                  <td>${App.esc(r.code || '')}</td>
                  <td style="text-align:left">${App.esc(r.sector || '')}</td>
                  <td>${App.esc(r.type || '--')}</td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>`;
    }).join('');

    // 隔板高标
    const hl = (data && data.highlighter) || [];
    const hlHtml = hl.length ? `
      <div class="card">
        <h2>隔板高标 <span class="tag">近期多次涨停但当日非连续连板</span></h2>
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>个股</th><th>累计板数</th><th>所属方向</th></tr></thead>
            <tbody>
              ${hl.map(r => `<tr>
                <td class="name">${App.esc(r.name)}</td>
                <td class="up">${App.esc(r.board)}</td>
                <td style="text-align:left">${App.esc(r.sector || '')}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>` : '';

    // 昨日涨停表现
    const yest = data && data.yesterday ? data.yesterday : null;
    const yestHtml = yest ? `
      <div class="card">
        <h2>昨日涨停今日表现</h2>
        <p style="font-size:14px">昨日涨停指数：<b class="${App.colorClass(yest.index)}">${App.fmtPct(yest.index)}</b>
        &nbsp;红盘率：<b>${App.esc(yest.redRate || '--')}</b>（${App.esc(yest.red || '--')}/${App.esc(yest.total || '--')}）</p>
        ${yest.note ? `<p style="font-size:12.5px;color:#8b949e;margin-top:6px">${App.esc(yest.note)}</p>` : ''}
      </div>` : '';

    el.innerHTML = `
      <div class="section-title"><span class="num">📶</span><h2>连板梯队</h2></div>
      ${dateBar}
      ${hero}
      ${boardHtml}
      ${hlHtml}
      ${yestHtml}
      ${data && data.note ? `<div class="card" style="font-size:13px;color:#8b949e">${App.esc(data.note)}</div>` : ''}`;

    el.querySelectorAll('[data-date]').forEach(b => b.addEventListener('click', () => {
      location.hash = '#/ladder/' + b.dataset.date;
    }));
    App.stamp(`连板梯队 ${date}`);
  }
};

App.register('ladder', LadderView);
