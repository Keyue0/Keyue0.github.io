/* ============================================================
   首页视图：Bing 主页（最新复盘摘要 + 功能入口）
   ============================================================ */
'use strict';

const HomeView = {
  title: 'Bing',

  async render(el) {
    // 最新复盘
    let latest = null;
    try {
      const list = await App.listReviews();
      if (list.length) latest = list[0];
    } catch (e) { /* 忽略 */ }

    const sentCls = latest ? (App.sentimentClass ? App.sentimentClass(latest.sentiment) : 'flat') : 'flat';

    el.innerHTML = `
      <div class="home-hero">
        <h1>Bing</h1>
        <p>冰川复盘 · 爱在冰川短线情绪周期框架复盘 + A股板块资金流向看板。框架化复盘/推演，数据均来自真实行情接口。</p>
        <div style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap">
          <a class="btn btn-blue" href="#/review">查看冰川复盘</a>
          <a class="btn btn-secondary-dark" href="#/capital-flow">查看资金流向</a>
        </div>
      </div>

      <div class="home-cards">
        <a class="home-card" href="#/review">
          <h3><span class="icon">📋</span>冰川复盘 <span class="arrow">→</span></h3>
          <p>九段框架：大盘情绪 / 板块效应 / 龙头梯队 / 主力资金 / 低位右侧 / 共振背离 / 明日计划。</p>
          ${latest ? `
            <div style="margin-top:12px;border-top:1px solid var(--hairline);padding-top:10px">
              <div style="font-size:15px;font-weight:700">最近：${App.esc(latest.date)}</div>
              <div style="font-size:12.5px;color:var(--muted);margin-top:4px">${App.esc(latest.summary || '')}</div>
              <div style="margin-top:8px">
                ${latest.sentiment ? `<span class="chip">情绪 <b class="${sentCls}">${App.esc(latest.sentiment)}</b></span>` : ''}
                ${latest.limitUp ? `<span class="chip">涨停 <b class="up">${App.esc(latest.limitUp)}</b></span>` : ''}
                ${latest.limitDown ? `<span class="chip">跌停 <b class="down">${App.esc(latest.limitDown)}</b></span>` : ''}
              </div>
            </div>` : ''}
        </a>

        <a class="home-card" href="#/capital-flow">
          <h3><span class="icon">💰</span>资金流向 <span class="arrow">→</span></h3>
          <p>板块主力资金实时看板（东方财富公开行情接口），概念/行业板块净流入排行、流入占比。</p>
        </a>
      </div>

      <div class="card" style="margin-top:16px">
        <h2>数据真实性说明</h2>
        <p style="font-size:13.5px;color:var(--muted)">
          冰川复盘数据：由本地复盘流程通过<strong>通达信 / 腾讯自选股</strong>真实行情接口获取（涨停跌停、指数点位、主力资金逐日序列等），非预测或编造；报告中均已标注数据来源与口径。<br>
          资金流向看板：直连<strong>东方财富公开行情接口</strong>实时数据。
        </p>
      </div>

      <div class="card" style="margin-top:12px">
        <h2>功能板块</h2>
        <p style="font-size:13.5px;color:var(--muted)">
          已上线：<b style="color:var(--text)">冰川复盘</b> · <b style="color:var(--text)">资金流向</b> · <b style="color:var(--text)">候选池跟踪</b> · <b style="color:var(--text)">连板梯队</b> · <b style="color:var(--text)">龙虎榜</b> · <b style="color:var(--text)">情绪曲线</b> · <b style="color:var(--text)">博主观点</b>（见顶部"更多"菜单）。<br>
          后续可持续扩展：情绪周期阶段识别、板块轮动热力图、低吸候选池状态回测等——框架已支持随时新增功能页。
        </p>
      </div>`;

    App.stamp('');
  }
};

App.register('home', HomeView);
