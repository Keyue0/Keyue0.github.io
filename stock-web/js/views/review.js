/* ============================================================
   冰川复盘视图（横向章节选择 + 单段独立显示）
   - 顶部 01-09 横向并列标签，点击切换显示当前段
   - 一次只显示一段，其他段不堆叠，段与段绝对独立
   - 上一段/下一段按钮导航；hash 支持 #/review/<日期>/<段号>
   ============================================================ */
'use strict';

const ReviewView = {
  title: '冰川复盘',

  async render(el, params) {
    let list = [];
    try { list = await App.listReviews(); } catch (e) { /* 忽略 */ }

    if (!list.length) {
      el.innerHTML = `
        <div class="section-title"><span class="num">📋</span><h2>冰川复盘</h2></div>
        <div class="card"><h2>暂无复盘记录</h2>
        <p>还没有可展示的复盘数据。运行本地复盘流程后会在这里生成九段复盘报告。</p></div>`;
      App.stamp('');
      return;
    }

    const date = params[0] || list[0].date;
    let review;
    try {
      review = await App.fetchJSON(`data/reviews/${date}.json`);
    } catch (e) {
      el.innerHTML = `<div class="card"><h2>⚠️ 加载失败</h2><p>${App.esc(e.message)}</p></div>`;
      return;
    }

    const sections = (review.sections || []).map((s, i) => ({ ...s, idx: i }));
    if (!sections.length) {
      el.innerHTML = `<div class="card"><h2>暂无内容</h2></div>`;
      return;
    }

    // 当前段（hash 第 2 位参数 1-9）
    const secParam = params[1] ? parseInt(params[1], 10) - 1 : 0;
    let cur = Math.min(Math.max(secParam, 0), sections.length - 1);

    const dateBar = `
      <div class="controls"><div class="group"><span class="glabel">复盘日期</span>
      ${list.map(r => `<button class="btn ${r.date === date ? 'active' : ''}" data-date="${App.esc(r.date)}">${App.esc(r.date)}</button>`).join('')}
      </div></div>`;

    const meta = list.find(r => r.date === date) || {};
    const sentCls = App.sentimentClass(meta.sentiment);
    const hero = `
      <div class="home-hero compact" style="padding:20px 26px">
        <h1 style="font-size:22px">A股复盘：${review.date}（${App.esc(review.weekday || '')}）</h1>
        <p style="margin-top:6px">${App.esc(review.summary || '')}</p>
        <div style="margin-top:12px">
          ${meta.sentiment ? `<span class="chip">情绪档位 <b class="${sentCls}">${App.esc(meta.sentiment)}</b></span>` : ''}
          ${meta.limitUp ? `<span class="chip">涨停 <b class="up">${App.esc(meta.limitUp)}</b></span>` : ''}
          ${meta.limitDown ? `<span class="chip">跌停 <b class="down">${App.esc(meta.limitDown)}</b></span>` : ''}
          ${meta.amount ? `<span class="chip">成交 <b>${App.esc(meta.amount)}亿</b></span>` : ''}
        </div>
      </div>`;

    // 顶部 01-09 横向并列标签（章节选择）
    const secTabs = `
      <div class="sec-tabs" id="sec-tabs">
        ${sections.map((s, i) => `
          <button class="sec-tab ${i === cur ? 'active' : ''}" data-sec="${i}">
            <span class="sec-tab-num">${String(i + 1).padStart(2, '0')}</span>
            <span class="sec-tab-title">${App.esc(s.title)}</span>
          </button>`).join('')}
      </div>`;

    const renderCurrent = () => {
      const s = sections[cur];
      // 仅渲染当前段一张大卡片（其他段不堆叠）
      const secHtml = `
        <div class="card review-section">
          <div class="review-sec-head">
            <span class="review-sec-num">${String(cur + 1).padStart(2, '0')}</span>
            <h2>${App.esc(s.title)}</h2>
          </div>
          ${App.mdToHtmlColored(s.content || '')}
        </div>
        <div class="sec-nav">
          <button class="btn" id="sec-prev" ${cur === 0 ? 'disabled' : ''}>← 上一段</button>
          <span style="color:var(--muted);font-weight:600">${cur + 1} / ${sections.length}</span>
          <button class="btn" id="sec-next" ${cur === sections.length - 1 ? 'disabled' : ''}>下一段 →</button>
        </div>`;

      const body = el.querySelector('#sec-body');
      if (body) body.innerHTML = secHtml;

      // 高亮当前标签
      el.querySelectorAll('.sec-tab').forEach((t, i) => t.classList.toggle('active', i === cur));
      // 当前标签滚入可视区
      const tab = el.querySelector(`.sec-tab[data-sec="${cur}"]`);
      if (tab && tab.scrollIntoView) tab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });

      // 绑定上一段/下一段
      const prev = el.querySelector('#sec-prev');
      const next = el.querySelector('#sec-next');
      if (prev) prev.addEventListener('click', () => { if (cur > 0) { cur--; location.hash = `#/review/${date}/${cur + 1}`; renderCurrent(); } });
      if (next) next.addEventListener('click', () => { if (cur < sections.length - 1) { cur++; location.hash = `#/review/${date}/${cur + 1}`; renderCurrent(); } });
    };

    el.innerHTML = `
      <div class="section-title"><span class="num">📋</span><h2>冰川复盘</h2></div>
      ${dateBar}
      ${hero}
      ${secTabs}
      <div id="sec-body"><div class="loading"><div class="spinner"></div><p>正在加载…</p></div></div>
      <div class="card" style="font-size:12.5px;color:#6c6a64;margin-top:36px">
        ⚠️ 免责声明：本报告为框架化复盘/推演，数据由本地复盘流程生成，不构成投资建议。
      </div>`;

    // 章节标签点击 → 切换到对应段
    el.querySelectorAll('.sec-tab').forEach(b => b.addEventListener('click', () => {
      const idx = parseInt(b.dataset.sec, 10);
      location.hash = `#/review/${date}/${idx + 1}`;
      cur = idx;
      renderCurrent();
    }));
    el.querySelectorAll('[data-date]').forEach(b => b.addEventListener('click', () => {
      location.hash = '#/review/' + b.dataset.date + '/1';
    }));

    renderCurrent();

    App.stamp(`复盘 ${review.date} · 九段横向选择`);
  }
};

App.register('review', ReviewView);
