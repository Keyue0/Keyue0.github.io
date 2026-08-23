/* ============================================================
   每日复盘视图
   - 从 data/reviews/index.json 读取复盘索引
   - 展示九段复盘内容（Markdown 渲染，涨跌着色）
   - 支持 hash 参数指定日期： #/review/2026-08-21
   ============================================================ */
'use strict';

const ReviewView = {
  title: '冰川复盘',

  async render(el, params) {
    let list = [];
    try {
      list = await App.listReviews();
    } catch (e) { /* 忽略 */ }

    if (!list.length) {
      el.innerHTML = `
        <div class="section-title"><span class="num">📋</span><h2>冰川复盘</h2></div>
        <div class="card"><h2>暂无复盘记录</h2>
        <p>还没有可展示的复盘数据。运行本地复盘流程后会在这里生成九段复盘报告。</p></div>`;
      App.stamp('');
      return;
    }

    const date = params[0] || list[0].date;
    const meta = list.find(r => r.date === date) || list[0];

    let review;
    try {
      review = await App.fetchJSON(`data/reviews/${date}.json`);
    } catch (e) {
      el.innerHTML = `<div class="card"><h2>⚠️ 加载失败</h2><p>${App.esc(e.message)}</p></div>`;
      return;
    }

    // 日期选择器
    const dateBar = `
      <div class="controls">
        <div class="group"><span class="glabel">复盘日期</span>
        ${list.map(r => `<button class="btn ${r.date === date ? 'active' : ''}" data-date="${App.esc(r.date)}">${App.esc(r.date)}</button>`).join('')}
        </div>
      </div>`;

    // 头部摘要
    const sentCls = App.sentimentClass ? App.sentimentClass(meta.sentiment) : 'flat';
    const hero = `
      <div class="home-hero" style="padding:20px 24px">
        <h1 style="font-size:22px">A股复盘：${review.date}（${App.esc(review.weekday || '')}）</h1>
        <p style="margin-top:6px">${App.esc(review.summary || '')}</p>
        <div style="margin-top:12px">
          ${meta.sentiment ? `<span class="chip">情绪档位 <b class="${sentCls}">${App.esc(meta.sentiment)}</b></span>` : ''}
          ${meta.limitUp ? `<span class="chip">涨停 <b class="up">${App.esc(meta.limitUp)}</b></span>` : ''}
          ${meta.limitDown ? `<span class="chip">跌停 <b class="down">${App.esc(meta.limitDown)}</b></span>` : ''}
          ${meta.amount ? `<span class="chip">成交 <b>${App.esc(meta.amount)}亿</b></span>` : ''}
        </div>
      </div>`;

    // 九段内容
    const sections = (review.sections || []).map((s, i) => `
      <div class="card review-section">
        <h2><span class="tag">第${i + 1}段</span>${App.esc(s.title)}</h2>
        ${App.mdToHtmlColored(s.content || '')}
      </div>`).join('');

    el.innerHTML = `
      <div class="section-title"><span class="num">📋</span><h2>冰川复盘</h2></div>
      ${dateBar}
      ${hero}
      ${sections}
      <div class="card" style="font-size:13px;color:#8b949e">
        ⚠️ 免责声明：本报告为框架化复盘/推演，数据由本地复盘流程生成，不构成投资建议。
      </div>`;

    // 日期切换
    el.querySelectorAll('[data-date]').forEach(b => b.addEventListener('click', () => {
      location.hash = '#/review/' + b.dataset.date;
    }));

    App.stamp(`复盘 ${review.date} · 数据由本地复盘流程生成`);
  }
};

App.register('review', ReviewView);
