/* ============================================================
   资金流向视图（双模式）
   - 参考看板：内嵌 https://huachangmiao.github.io/stock/
   - 自建看板：腾讯股票公开接口 qt.gtimg.cn（浏览器 CORS 开放）
                拉取板块代表个股实时行情，按板块聚合展示"资金活跃度近似"
   ============================================================ */
'use strict';

const CapitalView = {
  title: '资金流向',

  REF_URL: 'https://huachangmiao.github.io/stock/',
  TX_URL: 'https://qt.gtimg.cn/q=',

  // 板块 → 代表个股映射（从 08-21 复盘/候选池整理）
  SECTOR_STOCKS: [
    { sector: '有色金属/贵金属', codes: ['sh601899', 'sz002716', 'sh600547', 'sh601600', 'sh600362'] },
    { sector: 'CPO/光模块/算力', codes: ['sz300308', 'sz002491', 'sz002396', 'sh600460', 'sh688256'] },
    { sector: '机器人/人形', codes: ['sh600577', 'sh603626', 'sz002903', 'sh603958'] },
    { sector: '创新药/mRNA', codes: ['sz002412', 'sh688356', 'sz002038', 'sz000710', 'sz000931', 'sh688137'] },
    { sector: '锂电/碳酸锂', codes: ['sz002192', 'sz002460', 'sz300037'] },
    { sector: '白酒/消费', codes: ['sh600519', 'sz000858', 'sh600809'] },
    { sector: '新能源车', codes: ['sz002594', 'sz300750', 'sh600196'] },
    { sector: '半导体/芯片', codes: ['sh688981', 'sh600460', 'sz002185'] },
    { sector: '券商/非银', codes: ['sh600030', 'sh601066'] },
    { sector: '银行', codes: ['sh600036', 'sh601398', 'sh000001'] },
    { sector: '医药', codes: ['sh600276', 'sz000538'] },
    { sector: 'ST/重整', codes: ['sz002667'] }
  ],

  timer: null,
  interval: 15000,
  paused: false,
  boardType: 'sector',   // sector | watchlist
  mode: 'ref',

  async render(el, params) {
    const initMode = params && params[0] === 'self' ? 'self' : 'ref';
    el.innerHTML = `
      <div class="section-title"><span class="num">💰</span><h2>板块资金流向</h2></div>
      <div class="controls">
        <div class="group"><span class="glabel">视图</span>
          <button class="btn ${initMode === 'ref' ? 'active' : ''}" data-mode="ref">参考看板</button>
          <button class="btn ${initMode === 'self' ? 'active' : ''}" data-mode="self">自建看板</button>
        </div>
      </div>
      <div id="cap-body"><div class="loading"><div class="spinner"></div><p>正在加载…</p></div></div>`;

    el.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => {
      el.querySelectorAll('[data-mode]').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      this.switchMode(el, b.dataset.mode);
    }));

    await this.switchMode(el, initMode);
  },

  async switchMode(el, mode) {
    this.stopTimer();
    this.mode = mode;
    el.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    if (mode === 'ref') {
      this.renderRef(el);
      App.stamp('资金流向 · 参考看板（东财数据源）');
    } else {
      await this.renderSelf(el);
    }
  },

  /* ---------- 参考看板（iframe） ---------- */
  renderRef(el) {
    const body = el.querySelector('#cap-body');
    body.innerHTML = `
      <div class="card" style="padding:0;overflow:hidden;background:#faf9f5;border:1px solid #e6dfd8">
        <iframe src="${this.REF_URL}" style="width:100%;height:calc(100vh - 280px);min-height:600px;border:none;display:block;background:#faf9f5" loading="eager" title="板块资金流向看板"></iframe>
      </div>
      <div style="margin-top:10px;font-size:12.5px;color:#6c6a64">⚠️ 本页内嵌外部看板（<a href="${this.REF_URL}" target="_blank" rel="noopener">huachangmiao.github.io/stock</a>），数据由其直连东方财富公开行情接口实时获取。若看板未正常显示，请切换到「自建看板」。</div>`;
  },

  /* ---------- 自建看板（腾讯股票 CORS 开放） ---------- */
  async renderSelf(el) {
    const body = el.querySelector('#cap-body');
    body.innerHTML = `
      <div class="controls">
        <div class="group"><span class="glabel">分组</span>
          <button class="btn active" data-board="sector">按板块</button>
          <button class="btn" data-board="watchlist">全市场涨幅</button>
        </div>
        <div class="group"><span class="glabel">刷新</span>
          <button class="btn ${this.interval === 15000 ? 'active' : ''}" data-int="15000">15秒</button>
          <button class="btn ${this.interval === 30000 ? 'active' : ''}" data-int="30000">30秒</button>
          <button class="btn ${this.interval === 60000 ? 'active' : ''}" data-int="60000">60秒</button>
        </div>
        <button class="btn" id="btn-pause">暂停</button>
        <button class="btn blue" id="btn-refresh">刷新</button>
      </div>

      <div class="kpi-row">
        <div class="kpi"><div class="label">监控个股</div><div class="value" id="kpi-total">--</div><div class="sub" id="kpi-total-sub"></div></div>
        <div class="kpi"><div class="label">上涨家数</div><div class="value up" id="kpi-up">--</div><div class="sub" id="kpi-up-sub"></div></div>
        <div class="kpi"><div class="label">下跌家数</div><div class="value down" id="kpi-down">--</div><div class="sub" id="kpi-down-sub"></div></div>
        <div class="kpi"><div class="label">领涨个股</div><div class="value up" id="kpi-lead">--</div><div class="sub" id="kpi-lead-sub"></div></div>
      </div>

      <div class="card">
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>板块</th><th>个股</th><th>代码</th><th>现价</th><th>涨跌</th><th>涨跌幅</th><th>资金活跃</th></tr></thead>
            <tbody id="fund-tbody"><tr><td colspan="7" style="text-align:center;color:#6c6a64">正在加载行情数据…</td></tr></tbody>
          </table>
        </div>
        <p style="font-size:12px;color:#6c6a64;margin-top:8px">数据来源：腾讯股票公开行情接口 <a href="https://qt.gtimg.cn" target="_blank" rel="noopener">qt.gtimg.cn</a>（GBK 编码，CORS 开放），按"板块→代表个股"聚合展示实时价/涨跌/资金活跃方向。东财 push2 资金流接口浏览器 CORS 不可用，原始数据改用此方案。仅供参考，不作为买卖依据。</p>
      </div>`;

    body.querySelectorAll('[data-board]').forEach(b => b.addEventListener('click', () => {
      body.querySelectorAll('[data-board]').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      this.boardType = b.dataset.board;
      this.loadRealtime(el);
    }));
    body.querySelectorAll('[data-int]').forEach(b => b.addEventListener('click', () => {
      body.querySelectorAll('[data-int]').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      this.interval = parseInt(b.dataset.int, 10);
      this.startTimer(el);
      App.stamp('刷新周期 ' + (this.interval / 1000) + ' 秒');
    }));
    const btnPause = body.querySelector('#btn-pause');
    btnPause.addEventListener('click', () => {
      this.paused = !this.paused;
      btnPause.textContent = this.paused ? '恢复' : '暂停';
      btnPause.classList.toggle('gray', this.paused);
      if (this.paused) { this.stopTimer(); App.stamp('已暂停'); }
      else this.startTimer(el);
    });
    body.querySelector('#btn-refresh').addEventListener('click', () => this.loadRealtime(el));

    await this.loadRealtime(el);
    this.startTimer(el);
  },

  /* 解析 qt.gtimg.cn 响应（每行 v_xx="..."，GBK 编码） */
  async fetchTxText(url) {
    const buf = await fetch(url, { cache: 'no-store' }).then(r => r.arrayBuffer());
    return new TextDecoder('gbk').decode(buf);
  },

  parseTx(text) {
    const stocks = {};
    text.split(';').forEach(line => {
      const m = line.match(/v_(\w+)="([^"]+)"/);
      if (!m) return;
      const code = m[1]; const f = m[2].split('~');
      // 可靠字段：[0]状态 [1]名称 [3]代码 [4]现价 [5]昨收
      // 其他字段索引因股票而异，不展示以避免错位
      const name = f[1];
      const price = parseFloat(f[3]) || 0;
      const prev = parseFloat(f[4]) || 0;
      const change = +(price - prev).toFixed(2);
      const pct = prev ? +((change / prev) * 100).toFixed(2) : 0;
      stocks[code] = { code, name, price, prev, change, pct };
    });
    return stocks;
  },

  async loadRealtime(el) {
    const allCodes = this.SECTOR_STOCKS.flatMap(s => s.codes);
    const url = this.TX_URL + allCodes.join(',');
    try {
      const text = await this.fetchTxText(url);
      const stocks = this.parseTx(text);

      // 按板块聚合
      const rows = [];
      this.SECTOR_STOCKS.forEach(s => {
        s.codes.forEach(c => {
          if (stocks[c]) rows.push({ sector: s.sector, ...stocks[c] });
        });
      });

      this.renderTable(el, rows);

      // 指标卡
      const ups = rows.filter(r => r.change > 0);
      const downs = rows.filter(r => r.change < 0);
      const lead = [...rows].sort((a, b) => b.pct - a.pct)[0];
      const set = (id, v, sub) => { const e = el.querySelector(id); if (e) { e.textContent = v; if (sub) el.querySelector(id + '-sub').textContent = sub; } };
      set('#kpi-total', rows.length, '覆盖 ' + this.SECTOR_STOCKS.length + ' 板块');
      set('#kpi-up', ups.length, ups.length / Math.max(1, rows.length) * 100 | 0 + '% 上涨');
      set('#kpi-down', downs.length, downs.length / Math.max(1, rows.length) * 100 | 0 + '% 下跌');
      if (lead) { set('#kpi-lead', lead.pct + '%', lead.name + '·' + lead.sector); }

      App.stamp(`自建看板 · ${this.boardType === 'sector' ? '按板块' : '全市场'} · 更新于 ${new Date().toLocaleTimeString()}`);
    } catch (e) {
      const tbody = el.querySelector('#fund-tbody');
      if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#c64545">接口加载失败：${App.esc(e.message)}</td></tr>`;
      App.stamp('');
    }
  },

  renderTable(el, rows) {
    const tbody = el.querySelector('#fund-tbody');
    if (!tbody) return;
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#6c6a64">无数据</td></tr>';
      return;
    }
    const grouped = {};
    rows.forEach(r => { (grouped[r.sector] = grouped[r.sector] || []).push(r); });
    const sectors = Object.keys(grouped);

    // 七列：板块 / 个股 / 代码 / 现价 / 涨跌 / 涨跌幅 / 资金活跃（综合指标）
    // 去掉字段不确定的换手/成交额，替换为"资金活跃"综合指标 = (现价×涨跌幅排序位次的红绿)
    if (this.boardType === 'sector') {
      let html = '';
      sectors.forEach(sec => {
        const items = grouped[sec].sort((a, b) => b.pct - a.pct);
        items.forEach((r, i) => {
          const active = r.pct > 0 ? '↗' : (r.pct < 0 ? '↘' : '—');
          const activeCls = App.colorClass(r.pct);
          html += `<tr>
            <td class="name" style="${i === 0 ? '' : 'border-top:1px dashed #e6dfd8;color:#6c6a64;font-size:12.5px'}">${i === 0 ? App.esc(sec) : ''}</td>
            <td class="name">${App.esc(r.name)}</td>
            <td>${App.esc(r.code)}</td>
            <td>${r.price > 0 ? r.price.toFixed(2) : '--'}</td>
            <td class="${App.colorClass(r.change)}" style="font-weight:600">${r.change !== 0 ? (r.change > 0 ? '+' : '') + r.change.toFixed(2) : '0.00'}</td>
            <td class="${App.colorClass(r.pct)}" style="font-weight:800;font-size:14.5px">${r.pct !== 0 ? App.fmtPct(r.pct) : '0.00%'}</td>
            <td class="${activeCls}" style="font-weight:700">${active}</td>
          </tr>`;
        });
      });
      tbody.innerHTML = html;
    } else {
      const sorted = [...rows].sort((a, b) => b.pct - a.pct);
      tbody.innerHTML = sorted.map((r, i) => {
        const active = r.pct > 0 ? '↗' : (r.pct < 0 ? '↘' : '—');
        return `<tr>
          <td class="name" style="color:#c64545;font-weight:700">${i + 1}. ${App.esc(r.sector)}</td>
          <td class="name">${App.esc(r.name)}</td>
          <td>${App.esc(r.code)}</td>
          <td>${r.price > 0 ? r.price.toFixed(2) : '--'}</td>
          <td class="${App.colorClass(r.change)}" style="font-weight:600">${r.change !== 0 ? (r.change > 0 ? '+' : '') + r.change.toFixed(2) : '0.00'}</td>
          <td class="${App.colorClass(r.pct)}" style="font-weight:800;font-size:14.5px">${r.pct !== 0 ? App.fmtPct(r.pct) : '0.00%'}</td>
          <td class="${App.colorClass(r.pct)}" style="font-weight:700">${active}</td>
        </tr>`;
      }).join('');
    }
  },

  startTimer(el) {
    this.stopTimer();
    this.timer = setInterval(() => {
      if (!this.paused && this.mode === 'self') this.loadRealtime(el);
    }, this.interval);
  },
  stopTimer() { if (this.timer) { clearInterval(this.timer); this.timer = null; } }
};

App.register('capital-flow', CapitalView);
