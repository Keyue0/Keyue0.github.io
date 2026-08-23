/* ============================================================
   情绪曲线视图
   - data/sentiment.json：跨日情绪指标序列（复盘积累）
   - Canvas 折线图：涨停/跌停家数 + 连板高度
   ============================================================ */
'use strict';

const SentimentView = {
  title: '情绪曲线',

  async render(el) {
    let series = [];
    try { series = await App.fetchJSON('data/sentiment.json'); } catch (e) { series = []; }

    const latest = series.length ? series[series.length - 1] : null;
    const sentCls = latest ? App.sentimentClass(latest.sentiment) : 'flat';

    // 顶部指标
    const kpi = `
      <div class="kpi-row">
        <div class="kpi"><div class="label">最新情绪档位</div><div class="value ${sentCls}">${latest ? App.esc(latest.sentiment) : '--'}</div><div class="sub">${latest ? App.esc(latest.date) : ''}</div></div>
        <div class="kpi"><div class="label">涨停家数</div><div class="value up">${latest ? App.esc(latest.limitUp) : '--'}</div></div>
        <div class="kpi"><div class="label">跌停家数</div><div class="value down">${latest ? App.esc(latest.limitDown) : '--'}</div></div>
        <div class="kpi"><div class="label">连板高度</div><div class="value">${latest ? App.esc(latest.topBoard) + ' 板' : '--'}</div></div>
      </div>`;

    // 折线图（双区：家数 + 高度）
    const chartHtml = `
      <div class="card">
        <h2>情绪曲线 <span class="tag">每日积累，数据越多曲线越完整</span></h2>
        <div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:10px">
          <span style="font-size:13px;color:#8b949e"><i style="display:inline-block;width:10px;height:10px;background:#f85149;border-radius:2px;margin-right:4px"></i>涨停家数</span>
          <span style="font-size:13px;color:#8b949e"><i style="display:inline-block;width:10px;height:10px;background:#3fb950;border-radius:2px;margin-right:4px"></i>跌停家数</span>
          <span style="font-size:13px;color:#8b949e"><i style="display:inline-block;width:10px;height:10px;background:#d29922;border-radius:2px;margin-right:4px"></i>连板高度（右轴）</span>
        </div>
        <canvas id="sent-chart" style="width:100%;height:320px"></canvas>
      </div>`;

    // 数据表
    const tableHtml = `
      <div class="card">
        <h2>历史情绪数据</h2>
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>日期</th><th>情绪档位</th><th>涨停</th><th>跌停</th><th>涨/跌家数</th><th>涨跌比</th><th>连板高度</th><th>成交额(亿)</th></tr></thead>
            <tbody>
              ${series.slice().reverse().map(d => `
                <tr>
                  <td class="name">${App.esc(d.date)}</td>
                  <td><span class="chip ${App.sentimentClass(d.sentiment)}"><b>${App.esc(d.sentiment || '--')}</b></span></td>
                  <td class="up">${d.limitUp != null ? App.esc(d.limitUp) : '--'}</td>
                  <td class="down">${d.limitDown != null ? App.esc(d.limitDown) : '--'}</td>
                  <td>${d.upCount != null ? App.esc(d.upCount) + '/' + App.esc(d.downCount) : '--'}</td>
                  <td>${d.ratio != null ? App.esc(d.ratio) : '--'}</td>
                  <td class="up">${d.topBoard != null ? App.esc(d.topBoard) + ' 板' : '--'}</td>
                  <td>${d.amount != null ? App.esc(d.amount) : '--'}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <p style="font-size:12px;color:#8b949e;margin-top:8px">每天复盘后追加一条记录，情绪周期曲线自然成型。数据为真实行情接口口径（tdx_screener 等）。</p>
      </div>`;

    el.innerHTML = `
      <div class="section-title"><span class="num">📈</span><h2>情绪曲线</h2></div>
      ${kpi}
      ${chartHtml}
      ${tableHtml}`;

    App.stamp('情绪曲线 · 每日复盘积累');

    // 绘图
    const canvas = document.getElementById('sent-chart');
    if (canvas && series.length) {
      this.drawChart(canvas, series);
    } else if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#6c6a64';
      ctx.font = '14px sans-serif';
      ctx.fillText('暂无数据，完成复盘后自动积累', 20, 40);
    }
  },

  /* 双区折线图 */
  drawChart(canvas, series) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const W = rect.width || 800;
    const H = 320;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const pad = { l: 46, r: 16, t: 24, b: 30 };
    const innerW = W - pad.l - pad.r;

    const n = series.length;
    const dates = series.map(d => d.date.slice(5));

    // 上区：涨停/跌停家数
    const h1 = (H - pad.t - pad.b) * 0.62;
    const y1 = pad.t;
    const drawLine1 = (key, color) => {
      const vals = series.map(d => (d[key] != null ? d[key] : null));
      const max = Math.max(10, ...vals.filter(v => v != null));
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      let started = false;
      vals.forEach((v, i) => {
        if (v == null) return;
        const x = pad.l + (i / (n - 1 || 1)) * innerW;
        const y = y1 + h1 - (v / max) * h1;
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      });
      ctx.stroke();
      // 数值点
      vals.forEach((v, i) => {
        if (v == null) return;
        const x = pad.l + (i / (n - 1 || 1)) * innerW;
        const y = y1 + h1 - (v / max) * h1;
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#3d3d3a';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(v, x, y - 6);
      });
      return max;
    };
    const maxUp = drawLine1('limitUp', '#c64545');
    const maxDown = drawLine1('limitDown', '#3a9d63');

    // 坐标轴文字（上区）
    ctx.fillStyle = '#6c6a64';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(maxUp, pad.l - 6, y1 + 4);
    ctx.fillText(0, pad.l - 6, y1 + h1 + 4);

    // 下区：连板高度
    const h2Top = y1 + h1 + 18;
    const h2 = H - h2Top - pad.b;
    ctx.strokeStyle = '#e6dfd8';
    ctx.strokeRect(pad.l, h2Top, innerW, h2);
    const maxBoard = Math.max(1, ...series.map(d => d.topBoard || 0));
    ctx.strokeStyle = '#e8a55a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    series.forEach((d, i) => {
      const x = pad.l + (i / (n - 1 || 1)) * innerW;
      const y = h2Top + h2 - ((d.topBoard || 0) / maxBoard) * h2;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    series.forEach((d, i) => {
      const x = pad.l + (i / (n - 1 || 1)) * innerW;
      const y = h2Top + h2 - ((d.topBoard || 0) / maxBoard) * h2;
      ctx.fillStyle = '#e8a55a';
      ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#3d3d3a';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(d.topBoard || 0, x, y - 6);
    });
    ctx.fillStyle = '#6c6a64';
    ctx.textAlign = 'right';
    ctx.font = '10px sans-serif';
    ctx.fillText('连板高度', pad.l - 6, h2Top + 10);
    ctx.fillText(maxBoard, pad.l - 6, h2Top + 12);

    // X 轴日期
    ctx.fillStyle = '#6c6a64';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    const step = Math.max(1, Math.ceil(n / 8));
    dates.forEach((d, i) => {
      if (i % step !== 0 && i !== n - 1) return;
      const x = pad.l + (i / (n - 1 || 1)) * innerW;
      ctx.fillText(d, x, H - 8);
    });

    // 分隔线
    ctx.strokeStyle = '#e6dfd8';
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(pad.l, h2Top); ctx.lineTo(W - pad.r, h2Top); ctx.stroke();
    ctx.setLineDash([]);
  }
};

App.register('sentiment', SentimentView);
