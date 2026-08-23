/* ============================================================
   资金流向视图
   - 内嵌参考看板（https://huachangmiao.github.io/stock/）
   - 数据来自东方财富公开行情接口（参考站实时拉取）
   ============================================================ */
'use strict';

const CapitalView = {
  title: '资金流向',

  REF_URL: 'https://huachangmiao.github.io/stock/',

  async render(el) {
    el.innerHTML = `
      <div class="section-title"><span class="num">💰</span><h2>板块资金流向</h2></div>

      <div class="card" style="padding:0;overflow:hidden;box-shadow:none;border:1px solid #2d333b">
        <iframe
          id="ref-frame"
          src="${this.REF_URL}"
          style="width:100%;height:calc(100vh - 250px);min-height:640px;border:none;display:block;background:#0d1117"
          loading="eager"
          title="板块资金流向看板">
        </iframe>
      </div>

      <div style="margin-top:10px;font-size:12.5px;color:#8b949e">
        ⚠️ 本页内嵌外部看板（<a href="${this.REF_URL}" target="_blank" rel="noopener">huachangmiao.github.io/stock</a>），数据由其直连东方财富公开行情接口实时获取，仅供行情参考，不作为买卖依据。
      </div>`;

    // 提示当前时间
    App.stamp('资金流向 · 外部实时看板（东财数据源）');
  }
};

App.register('capital-flow', CapitalView);
