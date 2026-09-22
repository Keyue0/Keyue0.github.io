/* ============================================================
   行业拥挤度视图（申万二级）
   - data/industry_crowding.json：由 0914WB/tools/industry_crowding.py 生成
   - 口径：原「乘积 = n²/N」保留不变，另加同日横截面超额、规模中性、
     拥挤度分位、历史条件收益，并给出修正后的建议列。
   - 本清单是「拥挤度风控」，不是买入信号。
   ============================================================ */
'use strict';

const IndustryView = {
  title: '行业拥挤度',

  state: { sortKey: 'prod', sortDir: -1, advice: '', q: '' },

  async render(el) {
    let d = null;
    try { d = await App.fetchJSON('data/industry_crowding.json'); } catch (e) { d = null; }

    if (!d || !d.rows || !d.rows.length) {
      el.innerHTML = `<div class="section-title"><span class="num">🧭</span><h2>行业拥挤度</h2></div>
        <div class="card"><h2>暂无数据</h2>
        <p style="font-size:14px;color:var(--muted)">请先运行 <code>0914WB/tools/industry_crowding.py</code> 生成
        <code>data/industry_crowding.json</code>。</p></div>`;
      App.stamp('');
      return;
    }

    this.data = d;
    const s = d.summary || {};

    const kpis = `
      <div class="kpi-row">
        <div class="kpi"><div class="label">数据日期</div><div class="value" style="font-size:20px">${App.esc(d.date)}</div></div>
        <div class="kpi"><div class="label">强势股池</div><div class="value">${App.esc(d.pool_size)} <span style="font-size:13px;color:var(--muted)">只</span></div></div>
        <div class="kpi"><div class="label">覆盖行业</div><div class="value">${App.esc(d.n_industries)} <span style="font-size:13px;color:var(--muted)">个</span></div></div>
        <div class="kpi"><div class="label">回避 / 减配</div><div class="value">${App.esc(s.avoid || 0)} <span style="font-size:15px;color:var(--muted)">/</span> ${App.esc(s.reduce || 0)}</div></div>
        <div class="kpi"><div class="label">候选 / 中性</div><div class="value">${App.esc(s.candidate || 0)} <span style="font-size:15px;color:var(--muted)">/</span> ${App.esc(s.neutral || 0)}</div></div>
      </div>`;

    const caveats = (d.caveats || []).length ? `
      <div class="card note-card">
        <h2>⚠️ 读表前必看（口径与局限）</h2>
        <ul style="margin:6px 0 0 18px;font-size:13.5px;color:var(--body)">
          ${d.caveats.map(c => `<li style="margin-bottom:4px">${App.esc(c)}</li>`).join('')}
        </ul>
        <p style="font-size:12.5px;color:var(--muted);margin-top:8px">
          判定规则：回避 = ${App.esc((d.rules || {}).avoid || '--')}；减配 = ${App.esc((d.rules || {}).reduce || '--')}；
          候选 = ${App.esc((d.rules || {}).candidate || '--')}。
          过滤模式 <b>${App.esc(d.filter_mode || '--')}</b>。
        </p>
      </div>` : '';

    // ---- 统计依据：把「回避」规则成立的条件摊开 ----
    const ev = d.evidence;
    let evidence = '';
    if (ev && ev.table) {
      const hs = ev.horizons || [];
      const bands = Object.keys(ev.table);
      const cell = o => {
        if (!o) return '<td>--</td>';
        const cls = App.colorClass(o.exc);
        const star = o.sig ? ' <b title="95% 区间不含 0">★</b>' : '';
        return `<td class="${cls}">${App.fmtPct(o.exc, 2)}${star}</td>`;
      };
      evidence = `
        <div class="card">
          <h2>📐 统计依据 <span class="tag">「回避」规则成立的条件</span></h2>
          <p style="font-size:12.5px;color:var(--muted);margin:0 0 8px">
            ${App.esc(ev.sample)}｜单位：${App.esc(ev.unit)}<br>${App.esc(ev.method)}
            ${ev.mode_matched ? '' : `<br><b>⚠️ 当前过滤口径为 ${App.esc(ev.filter_mode)}，本表数值来自 ${App.esc(ev.table_mode)} 口径，仅供形态参考。</b>`}
          </p>
          <div class="table-wrap">
            <table class="data" id="ind-ev">
              <thead><tr><th style="text-align:left">乘积档</th>
                ${hs.map(h => `<th>${App.esc(h)}日</th>`).join('')}</tr></thead>
              <tbody>
                ${bands.map(b => `<tr><td style="text-align:left"><b>${App.esc(b)}</b></td>
                  ${(ev.table[b] || []).map(cell).join('')}</tr>`).join('')}
              </tbody>
            </table>
          </div>
          <ul style="margin:10px 0 0 18px;font-size:13px;color:var(--body);line-height:1.65">
            ${(ev.conclusions || []).map(c => `<li style="margin-bottom:5px">${App.esc(c)}</li>`).join('')}
          </ul>
          <p style="font-size:12px;color:var(--muted);margin-top:8px">
            ★ = 分块 bootstrap 95% 区间不含 0。<b>没有 ★ 的档位不要当结论用。</b>
          </p>
        </div>`;
    }

    // ---- 三张清单 ----
    const listBlock = (title, key, note) => {
      const arr = (d.lists && d.lists[key]) || [];
      if (!arr.length) return '';
      return `
        <div class="card">
          <h2>${title} <span class="tag">${arr.length} 个</span></h2>
          ${note ? `<p style="font-size:12.5px;color:var(--muted);margin-bottom:8px">${App.esc(note)}</p>` : ''}
          <div style="display:flex;flex-wrap:wrap;gap:8px">
            ${arr.map(r => `<span class="chip" title="n=${r.n} / N=${r.N}｜拥挤分位 ${r.crowd_pct}">${App.esc(r.sw2_name)}
              <b style="margin-left:6px">${App.esc((r.prod || 0).toFixed(1))}</b></span>`).join('')}
          </div>
        </div>`;
    };

    const listsHtml =
      listBlock('🚫 回避清单', 'avoid', '原乘积已进最热档（>10），或拥挤度分位进入前 10%。风控意义上「不新开仓 / 已有仓位减」。注意：该规则的负超额只在短持有期（≤60 日）下显著，见上方「统计依据」。') +
      listBlock('⚠️ 减配清单', 'reduce', '拥挤度分位前 25%，尚未到最热档。') +
      listBlock('🌱 候选清单', 'candidate', '拥挤度分位后 25% 且乘积仍有强度（≥3）。注意：按拥挤度分位划分时，最低分位组相对最高分位组只有约 +0.9pp 的超额（方向对但幅度小）；真正稳健的是「乘积 <1 档」本身（见上方统计依据），二者不是一回事。仅作观察池。');

    // ---- 全表 ----
    const COLS = [
      { k: 'sw2_name', t: '行业', align: 'left', w: 1 },
      { k: 'l1', t: '一级', align: 'left' },
      { k: 'n', t: 'n', int: 1, tip: '强势股池中属于该行业的只数（按唯一代码）' },
      { k: 'N', t: 'N', int: 1, tip: '成分股清单行数（不去重）' },
      { k: 'prod', t: '乘积', f: 2, tip: 'n²/N —— 原口径，保留不变' },
      { k: 'band', t: '档位', align: 'left' },
      { k: 'share', t: '份额', pct: 1, tip: 'n/N' },
      { k: 'd5', t: 'Δ5', pct: 1, tip: '份额 5 日变化' },
      { k: 'd10', t: 'Δ10', pct: 1, tip: '份额 10 日变化' },
      { k: 'crowd_pct', t: '拥挤分位', f: 0, tip: '乘积的历史分位（0~100，越高越拥挤）' },
      { k: 'whip', t: '剪刀差', pct: 1, tip: '龙头 20 日收益 − 行业内中位数收益' },
      { k: 'amt20_med', t: '20日均额', f: 2, tip: '行业内中位成交额（亿元）' },
      { k: 'hist_band_exc30', t: '同档超额30', signed: 1, tip: '该档位历史未来 30 日横截面超额（%）' },
      { k: 'hist_band_exc60', t: '同档超额60', signed: 1, tip: '该档位历史未来 60 日横截面超额（%）' },
      { k: 'v2_advice', t: '原建议', align: 'left' },
      { k: 'fix_advice', t: '修正', align: 'left' },
      { k: 'final_advice', t: '最终', align: 'left' },
    ];

    const head = COLS.map(c =>
      `<th data-sort="${c.k}" style="cursor:pointer;${c.align === 'left' ? 'text-align:left;' : ''}white-space:nowrap"
        title="${App.esc(c.tip || '')}">${App.esc(c.t)}<span class="sarrow" data-arrow="${c.k}"></span></th>`).join('');

    const controls = `
      <div class="controls">
        <div class="group"><span class="glabel">建议</span>
          ${['', '回避', '减配', '候选', '中性'].map(a =>
            `<button class="btn ${this.state.advice === a ? 'active' : ''}" data-adv="${a}">${a || '全部'}</button>`).join('')}
        </div>
        <div class="group"><span class="glabel">搜索</span>
          <input id="ind-q" class="ind-input" placeholder="行业名 / 代码 / 一级行业" value="${App.esc(this.state.q)}">
        </div>
      </div>`;

    el.innerHTML = `
      <div class="section-title"><span class="num">🧭</span><h2>行业拥挤度（申万二级）</h2></div>
      ${kpis}
      ${caveats}
      ${evidence}
      ${listsHtml}
      <div class="card">
        <h2>全行业明细 <span class="tag" id="ind-count"></span></h2>
        <p style="font-size:12.5px;color:var(--muted);margin-bottom:8px">
          点击表头排序；默认按「乘积」降序。<b>乘积数值不可与外部报告表格直接对照</b>（代理过滤口径存在约 ±3 只残差），
          可对照的是排序与档位形态。
        </p>
        ${controls}
        <div class="table-wrap">
          <table class="data" id="ind-table">
            <thead><tr>${head}</tr></thead>
            <tbody id="ind-body"></tbody>
          </table>
        </div>
      </div>`;

    // 注入少量样式（仅本视图）
    if (!document.getElementById('ind-style')) {
      const st = document.createElement('style');
      st.id = 'ind-style';
      st.textContent = `
        .ind-input{font:inherit;font-size:13px;padding:5px 10px;border:1px solid var(--hairline);
          border-radius:var(--r-sm);background:var(--canvas);color:var(--ink);min-width:190px}
        #ind-table td{font-variant-numeric:tabular-nums}
        .sarrow{opacity:.45;margin-left:3px;font-size:10px}`;
      document.head.appendChild(st);
    }

    this.renderRows(el);

    // 排序
    el.querySelectorAll('[data-sort]').forEach(th => th.addEventListener('click', () => {
      const k = th.dataset.sort;
      if (this.state.sortKey === k) this.state.sortDir *= -1;
      else { this.state.sortKey = k; this.state.sortDir = (k === 'sw2_name' || k === 'l1' || k === 'band' || k.endsWith('advice')) ? 1 : -1; }
      this.renderRows(el);
    }));
    // 建议筛选
    el.querySelectorAll('[data-adv]').forEach(b => b.addEventListener('click', () => {
      this.state.advice = b.dataset.adv;
      el.querySelectorAll('[data-adv]').forEach(x => x.classList.toggle('active', x === b));
      this.renderRows(el);
    }));
    // 搜索
    const q = el.querySelector('#ind-q');
    if (q) q.addEventListener('input', () => { this.state.q = q.value.trim(); this.renderRows(el); });

    App.stamp(`行业拥挤度 ${d.date} · 池 ${d.pool_size} 只`);
  },

  /* 建议 → 彩色标签。注意：必须是视图上的方法，不能写成 render() 内部的 const ——
     renderRows() 是独立方法，词法作用域取「定义处」，拿不到 render() 的局部变量。 */
  advChip(a) {
    const style = {
      '回避': 'background:var(--surface-dark);color:#fff;border-color:var(--surface-dark)',
      '减配': 'background:rgba(232,165,90,.18);color:#8a5a12;border-color:rgba(232,165,90,.45)',
      '候选': 'background:rgba(93,184,166,.16);color:#1f6b5c;border-color:rgba(93,184,166,.45)',
      '中性': '',
    }[a] || '';
    return `<span class="chip" style="${style}">${App.esc(a)}</span>`;
  },

  renderRows(el) {
    const d = this.data;
    const st = this.state;
    const key = st.sortKey, dir = st.sortDir;

    let rows = (d.rows || []).slice();
    if (st.advice) rows = rows.filter(r => r.final_advice === st.advice);
    if (st.q) {
      const q = st.q.toLowerCase();
      rows = rows.filter(r => [r.sw2_name, r.sw2_code, r.l1].some(v => String(v || '').toLowerCase().includes(q)));
    }

    const isStr = v => typeof v === 'string';
    rows.sort((a, b) => {
      let x = a[key], y = b[key];
      if (x == null) x = isStr(y) ? '' : -Infinity;
      if (y == null) y = isStr(x) ? '' : -Infinity;
      if (isStr(x) && isStr(y)) return dir * x.localeCompare(y, 'zh');
      return dir * ((x > y) - (x < y));
    });

    const num = (v, f) => (v == null || isNaN(v)) ? '--' : Number(v).toFixed(f);
    const signed = (v, f) => (v == null || isNaN(v)) ? '--' : App.fmtPct(v, f);
    const pctv = (v, f) => (v == null || isNaN(v)) ? '--' : (v * 100).toFixed(f) + '%';

    const tbody = el.querySelector('#ind-body');
    tbody.innerHTML = rows.map(r => {
      const excCls = v => (v == null || isNaN(v)) ? '' : App.colorClass(v);
      return `<tr>
        <td class="name" style="text-align:left;white-space:nowrap">${App.esc(r.sw2_name)}
          <span style="color:var(--muted);font-size:11.5px;margin-left:4px">${App.esc(r.sw2_code)}</span></td>
        <td style="text-align:left;color:var(--muted)">${App.esc(r.l1 || '')}</td>
        <td>${num(r.n, 0)}</td>
        <td>${num(r.N, 0)}</td>
        <td><b>${num(r.prod, 2)}</b></td>
        <td style="text-align:left">${App.esc(r.band || '')}</td>
        <td>${pctv(r.share, 1)}</td>
        <td class="${App.colorClass(r.d5)}">${r.d5 == null ? '--' : (r.d5 * 100).toFixed(1) + '%'}</td>
        <td class="${App.colorClass(r.d10)}">${r.d10 == null ? '--' : (r.d10 * 100).toFixed(1) + '%'}</td>
        <td>${num(r.crowd_pct, 0)}</td>
        <td class="${App.colorClass(r.whip)}">${r.whip == null ? '--' : (r.whip * 100).toFixed(1) + '%'}</td>
        <td>${num(r.amt20_med, 2)}</td>
        <td class="${excCls(r.hist_band_exc30)}">${signed(r.hist_band_exc30, 2)}</td>
        <td class="${excCls(r.hist_band_exc60)}">${signed(r.hist_band_exc60, 2)}</td>
        <td style="text-align:left;color:var(--muted);font-size:12.5px">${App.esc(r.v2_advice || '')}</td>
        <td style="text-align:left;font-size:12.5px">${App.esc(r.fix_advice || '')}</td>
        <td style="text-align:left">${this.advChip(r.final_advice)}</td>
      </tr>`;
    }).join('') || `<tr><td colspan="17" style="text-align:center;color:var(--muted);padding:18px">无匹配结果</td></tr>`;

    const cnt = el.querySelector('#ind-count');
    if (cnt) cnt.textContent = `${rows.length} / ${(d.rows || []).length} 个`;

    el.querySelectorAll('.sarrow').forEach(s => {
      s.textContent = s.dataset.arrow === key ? (dir > 0 ? '▲' : '▼') : '';
    });
  }
};

App.register('industry', IndustryView);
