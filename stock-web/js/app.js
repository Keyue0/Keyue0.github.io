/* ============================================================
   冰川复盘 · 应用核心（hash 路由 + 视图注册）
   新增功能：写一个视图 JS 文件，调用 App.register(name, view) 注册，
   再在 index.html 的 <nav> 和 <script> 中加上即可。
   ============================================================ */
'use strict';

const App = {
  views: {},
  current: null,
  pending: null,

  register(name, view) {
    this.views[name] = view;
  },

  /* ---------- 路由 ---------- */
  async navigate() {
    const hash = location.hash.slice(1) || '/home';
    const parts = hash.split('/').filter(Boolean);
    const name = parts[0] || 'home';
    const params = parts.slice(1);
    const view = this.views[name];

    if (!view) {
      location.hash = '#/home';
      return;
    }

    // 导航高亮
    document.querySelectorAll('.nav a').forEach(a => {
      a.classList.toggle('active', a.dataset.route === name);
    });
    // 路由切换后收起"更多"下拉
    const dd = document.getElementById('more-dropdown');
    if (dd) dd.classList.remove('open');

    // 标题
    document.title = view.title
      ? (view.title === 'Bing' ? 'Bing' : view.title + ' · Bing')
      : 'Bing';

    // 渲染
    const app = document.getElementById('app');
    app.innerHTML = '<div class="loading"><div class="spinner"></div><p>正在加载…</p></div>';
    this.current = name;

    try {
      const stop = this.pending;
      this.pending = () => {};
      if (stop) stop();
      await view.render(app, params);
    } catch (e) {
      console.error('view render error:', e);
      app.innerHTML = `<div class="card"><h2>⚠️ 加载失败</h2><p>${App.esc(e && e.message ? e.message : String(e))}</p></div>`;
    }
  },

  /* ---------- 工具函数 ---------- */
  esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  },

  /* 数字 → 亿/万 字符串 */
  fmtNum(v, digits = 2) {
    if (v == null || isNaN(v)) return '--';
    const abs = Math.abs(v);
    const sign = v < 0 ? '-' : '';
    if (abs >= 1e8) return sign + (abs / 1e8).toFixed(digits) + '亿';
    if (abs >= 1e4) return sign + (abs / 1e4).toFixed(digits) + '万';
    return sign + v.toFixed(digits);
  },

  /* 数字（亿为单位）→ 带符号字符串 */
  fmtYi(v, digits = 2) {
    if (v == null || isNaN(v)) return '--';
    const sign = v > 0 ? '+' : (v < 0 ? '-' : '');
    return sign + Math.abs(v).toFixed(digits);
  },

  fmtPct(v, digits = 2) {
    if (v == null || isNaN(v)) return '--';
    const sign = v > 0 ? '+' : (v < 0 ? '-' : '');
    return sign + Math.abs(v).toFixed(digits) + '%';
  },

  /* 涨跌色 class：涨红跌绿 */
  colorClass(v) {
    if (v == null || isNaN(v) || v === 0) return 'flat';
    return v > 0 ? 'up' : 'down';
  },

  /* 情绪档位 → 色 class */
  sentimentClass(s) {
    const map = { '冰点': 'down', '修复': 'up', '中枢': 'flat', '亢奋': 'up', '退潮': 'down' };
    return map[s] || 'flat';
  },

  /* Markdown 简化渲染：**加粗** / 行首>引用 / 表格（基础） */
  mdToHtml(md) {
    if (!md) return '';
    const escMd = md
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const lines = escMd.split('\n');
    let html = '', inTable = false;
    const closeTable = () => { if (inTable) { html += '</tbody></table>'; inTable = false; } };

    for (let line of lines) {
      const trimmed = line.trim();
      if (!trimmed) { closeTable(); continue; }

      // 表格
      if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
        const cells = trimmed.slice(1, -1).split('|').map(c => c.trim());
        const isSep = cells.every(c => /^:?-{2,}:?$/.test(c));
        if (isSep) continue;
        if (!inTable) {
          html += '<div class="table-wrap"><table class="data"><thead><tr>';
          cells.forEach(c => { html += `<th>${bold(c)}</th>`; });
          html += '</tr></thead><tbody>';
          inTable = true;
        } else {
          html += '<tr>';
          cells.forEach((c, i) => {
            const cls = i === 0 ? 'name' : '';
            html += `<td class="${cls}">${bold(c)}</td>`;
          });
          html += '</tr>';
        }
        continue;
      }
      closeTable();

      // 引用
      if (trimmed.startsWith('>')) {
        html += `<div class="review-blockquote">${bold(trimmed.replace(/^>\s?/, ''))}</div>`;
        continue;
      }
      // 无序列表
      if (/^[-*]\s/.test(trimmed)) {
        html += `<p style="margin-left:14px">• ${bold(trimmed.replace(/^[-*]\s/, ''))}</p>`;
        continue;
      }
      // 有序列表
      if (/^\d+\.\s/.test(trimmed)) {
        html += `<p style="margin-left:14px">${bold(trimmed)}</p>`;
        continue;
      }
      // 标题
      if (/^#{1,4}\s/.test(trimmed)) {
        const level = trimmed.match(/^#+/)[0].length;
        const tag = level <= 2 ? 'h3' : 'h4';
        html += `<${tag}>${bold(trimmed.replace(/^#+\s/, ''))}</${tag}>`;
        continue;
      }
      html += `<p>${bold(trimmed)}</p>`;
    }
    closeTable();
    return html;
  },

  /* 带颜色的 Markdown 渲染（识别资金流向表格中的正负号颜色） */
  mdToHtmlColored(md) {
    if (!md) return '';
    let html = this.mdToHtml(md);
    // 给表格中的 +/- 数字加颜色（红色正、绿色负）
    html = html.replace(/<td class="name">([^<]*)<\/td>\s*<td>([+\-][\d.]+)<\/td>/g,
      (m, name, v) => {
        const cls = parseFloat(v) > 0 ? 'up' : 'down';
        return `<td class="name">${name}</td><td class="${cls}">${v}</td>`;
      });
    return html;
  },

  /* 轻量 Markdown 加粗处理 */
  bold(s) {
    return s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\*([^*]+)\*/g, '<i>$1</i>');
  },

  /* fetch JSON，带错误提示 */
  async fetchJSON(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return res.json();
  },

  /* 读取 data/reviews/ 下所有复盘 JSON 的索引（按日期降序） */
  async listReviews() {
    const url = 'data/reviews/index.json';
    const idx = await this.fetchJSON(url);
    return Array.isArray(idx) ? idx : [];
  },

  /* 更新页面顶部时间戳 */
  stamp(text) {
    const el = document.getElementById('update-time');
    if (el) el.textContent = text || '';
  }
};

window.App = App;

/* ---------- 路由事件 ---------- */
window.addEventListener('hashchange', () => App.navigate());
window.addEventListener('DOMContentLoaded', () => {
  App.navigate();
  // "更多"下拉交互
  const dd = document.getElementById('more-dropdown');
  const toggle = document.getElementById('more-toggle');
  if (dd && toggle) {
    toggle.addEventListener('click', e => {
      e.stopPropagation();
      dd.classList.toggle('open');
    });
    document.addEventListener('click', e => {
      if (!dd.contains(e.target)) dd.classList.remove('open');
    });
  }
});
