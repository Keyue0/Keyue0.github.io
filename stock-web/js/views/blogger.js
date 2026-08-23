/* ============================================================
   博主观点视图
   - data/views/index.json：来自抖音/小红书等渠道的博主观点
   - 后续从公开渠道整理纳入（标注来源与日期，供复盘参考）
   ============================================================ */
'use strict';

const BloggerView = {
  title: '博主观点',

  async render(el) {
    let items = [];
    try { items = await App.fetchJSON('data/views/index.json'); } catch (e) { items = []; }

    const platforms = [...new Set(items.map(i => i.platform).filter(Boolean))];

    const cards = items.length ? `
      <div class="controls">
        <div class="group"><span class="glabel">平台筛选</span>
          <button class="btn active" data-platform="">全部</button>
          ${platforms.map(p => `<button class="btn" data-platform="${App.esc(p)}">${App.esc(p)}</button>`).join('')}
        </div>
      </div>
      <div id="view-list">
        ${items.map(i => this.card(i)).join('')}
      </div>` : '';

    const empty = !items.length ? `
      <div class="card">
        <h2>暂无博主观点</h2>
        <p style="font-size:14px;color:#8b949e">本板块用于收录从<strong>抖音 / 小红书</strong>等公开渠道获取的财经博主观点，整理后供复盘参考（非投资建议）。</p>
        <p style="font-size:13.5px;color:#8b949e;margin-top:8px">待录入格式：</p>
        <pre style="background:#0d1117;border:1px solid #2d333b;border-radius:8px;padding:12px;font-size:12.5px;color:#8b949e;overflow-x:auto;margin-top:6px">{
  "date": "2026-08-22",          // 观点发布日期
  "platform": "抖音",            // 来源平台：抖音/小红书/其他
  "blogger": "博主名",
  "topic": "有色金属",           // 话题/板块
  "view": "观点摘要……",
  "sentiment": "看多",           // 看多/看空/中性
  "link": "https://…"            // 来源链接（可选）
}</pre>
      </div>` : '';

    const countHtml = items.length ? `
      <div class="card" style="font-size:13px;color:#8b949e">
        共收录 <b style="color:var(--text)">${items.length}</b> 条博主观点（按日期倒序）。观点仅作复盘参考，不构成投资建议；收录时保留原始来源与日期，避免断章取义。
      </div>` : '';

    el.innerHTML = `
      <div class="section-title"><span class="num">🗣️</span><h2>博主观点</h2></div>
      ${cards}
      ${empty}
      ${countHtml}`;

    // 平台筛选
    el.querySelectorAll('[data-platform]').forEach(b => b.addEventListener('click', () => {
      el.querySelectorAll('[data-platform]').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      const p = b.dataset.platform;
      const listEl = document.getElementById('view-list');
      if (!listEl) return;
      const filtered = p ? items.filter(i => i.platform === p) : items;
      listEl.innerHTML = filtered.map(i => this.card(i)).join('') || '<div class="card"><p style="color:#8b949e">该平台暂无观点</p></div>';
    }));

    App.stamp('博主观点 · 渠道整理录入');
  },

  card(i) {
    const sentCls = { '看多': 'up', '看空': 'down', '中性': 'flat' }[i.sentiment] || 'flat';
    return `
      <div class="card" style="margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">
          <span class="chip"><b>${App.esc(i.platform || '其他')}</b></span>
          <span style="font-size:15px;font-weight:700">${App.esc(i.blogger)}</span>
          ${i.sentiment ? `<span class="chip ${sentCls}"><b>${App.esc(i.sentiment)}</b></span>` : ''}
          <span style="font-size:12px;color:#8b949e;margin-left:auto">${App.esc(i.date || '')}</span>
        </div>
        ${i.topic ? `<div style="margin-bottom:6px"><span class="chip">话题：${App.esc(i.topic)}</span></div>` : ''}
        <p style="font-size:14px">${App.esc(i.view || '')}</p>
        ${i.link ? `<p style="margin-top:6px;font-size:12px"><a href="${App.esc(i.link)}" target="_blank" rel="noopener">来源链接 ↗</a></p>` : ''}
      </div>`;
  }
};

App.register('blogger', BloggerView);
