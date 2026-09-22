/* ============================================================
   视图渲染冒烟测试（无浏览器）
   ------------------------------------------------------------
   为什么需要它：这些视图是 hash-route SPA，页面「能打开」不代表视图「能渲染」。
   只要视图里有一个 ReferenceError，整个视图会白屏，但 HTTP 仍是 200、
   资源也照常返回，靠 curl 完全看不出来。这个脚本用最小 DOM 桩真实执行
   view.render(el)，把运行时报错暴露在命令行里。

   用法：
     node tools/smoke_view.js                 # 默认测 industry
     node tools/smoke_view.js industry        # 指定视图名（对应 js/views/<名>.js）
     node tools/smoke_view.js industry review # 一次测多个

   已知会踩的坑（本脚本就是为它们写的）：
     1. 跨方法引用局部变量。render() 里写 `const helper = ...`，
        然后在 renderRows() 里用 helper —— 词法作用域取「定义处」，
        renderRows 是对象方法、作用域是模块级，拿不到 → ReferenceError。
        辅助函数必须做成视图上的方法（this.helper），或用模块级 const。
     2. 静态检查（node --check）只查语法，查不出这类运行时错误。
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');          // stock-web/
const VIEW_DIR = path.join(ROOT, 'js', 'views');

// ---------------------------------------------------------------- 最小 DOM 桩
function makeEl(tag) {
  return {
    tagName: tag || 'div',
    _html: '',
    dataset: {},
    style: {},
    textContent: '',
    classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); },
    addEventListener() {},
    appendChild() {},
    // 桩：任何查询都返回一个「可用但为空」的元素，避免视图因桩返回 null 而中断
    querySelector() { return makeEl('div'); },
    querySelectorAll() { return []; },
  };
}

function installGlobals() {
  const el = makeEl('div');
  global.document = {
    getElementById() { return null; },
    createElement(t) { return makeEl(t); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    head: makeEl('head'),
    body: el,
  };
  // window 桩：app.js 末尾会挂 hashchange / DOMContentLoaded 监听，不注册即可
  global.window = { addEventListener() {}, location: { hash: '' }, App: null };
  global.location = global.window.location;
  global.fetch = async () => { throw new Error('smoke: 网络被禁用'); };

  // ---- 加载真实的 app.js，而不是手工复刻它的方法 ----
  // 这样 mdToHtml / mdToHtmlColored / bold / fmtPct 等全部是真实现，
  // 视图里用到什么都不会因为「桩没实现」而假报错。
  // eslint-disable-next-line no-eval
  eval(fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf-8'));

  const App = global.window.App;
  if (!App) throw new Error('app.js 没有导出 window.App');
  global.App = App;

  // fetchJSON 改走磁盘，绕过网络
  App.fetchJSON = async p => {
    const f = path.join(ROOT, p);
    if (!fs.existsSync(f)) throw new Error(`smoke: 文件不存在 ${p}`);
    return JSON.parse(fs.readFileSync(f, 'utf-8'));
  };
  return App.views;
}

// ---------------------------------------------------------------- 单视图测试
async function smoke(name) {
  const file = path.join(VIEW_DIR, `${name}.js`);
  if (!fs.existsSync(file)) {
    console.log(`  ✗ ${name}: 找不到 ${path.relative(ROOT, file)}`);
    return false;
  }
  let registry;
  try {
    registry = installGlobals();
  } catch (e) {
    console.log(`  ✗ 初始化失败 — ${e.message}`);
    return false;
  }
  try {
    // 用 eval 而非 require：视图脚本是浏览器风格（无 module.exports），
    // 且需要共享上面注入的 global.App / global.document。
    // eslint-disable-next-line no-eval
    eval(fs.readFileSync(file, 'utf-8'));
  } catch (e) {
    console.log(`  ✗ ${name}: 脚本求值失败 — ${e.message}`);
    return false;
  }

  const view = registry[name];
  if (!view) {
    // 文件名与注册名不一致是合法的（如 capital.js 注册为 capital-flow），
    // 此时如果只注册了一个视图，就按它测。
    const keys = Object.keys(registry);
    if (keys.length === 1) {
      console.log(`  · ${name}: 注册名为 '${keys[0]}'（文件名与路由名不同），按它继续`);
      return smokeRegistered(name, keys[0], registry[keys[0]]);
    }
    console.log(`  ✗ ${name}: 脚本没有注册任何匹配的视图`);
    console.log(`     已注册: ${keys.join(', ') || '（无）'}`);
    return false;
  }
  return smokeRegistered(name, name, view);
}

async function smokeRegistered(label, routeName, view) {
  if (typeof view.render !== 'function') {
    console.log(`  ✗ ${label}: view.render 不是函数`);
    return false;
  }

  const el = makeEl('div');
  try {
    // 真实路由会传 (el, params)；params 是数组，缺了会让 params[0] 抛 TypeError
    await view.render(el, []);
  } catch (e) {
    console.log(`  ✗ ${label}: render() 抛错 — ${e.name}: ${e.message}`);
    if (e.stack) {
      const line = String(e.stack).split('\n').find(l => l.includes('views') || l.includes('<anonymous>'));
      if (line) console.log(`     ${line.trim()}`);
    }
    return false;
  }

  const html = el.innerHTML || '';
  if (!html.length) {
    console.log(`  ✗ ${label}: render() 完成但输出为空（视图可能提前 return 了）`);
    return false;
  }
  const nTr = (html.match(/<tr>/g) || []).length;
  const nTd = (html.match(/<td/g) || []).length;
  const nCard = (html.match(/class="card"/g) || []).length;
  console.log(`  ✓ ${label}${routeName === label ? '' : ` (${routeName})`}: `
    + `${html.length} 字符 / ${nCard} 卡片 / ${nTr} 行 / ${nTd} 单元格`);
  return true;
}

// ---------------------------------------------------------------- 入口
(async () => {
  const args = process.argv.slice(2);
  const names = args.length ? args : ['industry'];
  console.log(`视图渲染冒烟测试（${names.length} 个）`);
  let ok = 0;
  for (const n of names) {
    // eslint-disable-next-line no-await-in-loop
    if (await smoke(n)) ok++;
  }
  console.log(`\n结果：${ok}/${names.length} 通过`);
  process.exit(ok === names.length ? 0 : 1);
})();
