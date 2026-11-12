// 人格档案页：把三面（DISC）、16 型（OEJTS）、阅读人格三份结果并排摆开。
// 只做并列展示，不自动生成「三份合起来说明什么」的结论。
(() => {
  'use strict';

  const CONTENT = window.WP_CONTENT || { TYPE_NAMES: {} };
  const OEJTS = window.WP_OEJTS_CONTENT || { types: {}, dims: {} };
  const READING = window.WP_READING_CONTENT || { dims: [], types: {} };

  const HISTORY_KEY = 'wp_history';
  const OEJTS_KEY = 'wp_oejts_result';
  const READING_KEY = 'wp_reading_result';
  const STAGE_NAME = { natural: '自然', work: '工作', stress: '压力' };

  const view = document.getElementById('profile-view');
  const log = (...args) => console.log('[wp] profile', ...args);

  // ── 本地存储 ─────────────────────────────
  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (err) {
      return fallback;
    }
  }

  function loadDisc() {
    const list = readJSON(HISTORY_KEY, []);
    if (!Array.isArray(list)) return null;
    const items = list
      .filter((item) => item && item.id && item.createdAt && item.code && item.byStage)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return items[0] || null;
  }

  function loadOejts() {
    const raw = readJSON(OEJTS_KEY, null);
    return raw && raw.code && raw.dims ? raw : null;
  }

  function loadReading() {
    const raw = readJSON(READING_KEY, null);
    return raw && raw.code && raw.dims ? raw : null;
  }

  // ── 小工具 ───────────────────────────────
  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatDate(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function head(title, date) {
    return `
      <div class="wp-arch-head">
        <h3 class="wp-section-title">${escapeHtml(title)}</h3>
        ${date ? `<span class="wp-hint">${formatDate(date)}</span>` : ''}
      </div>
    `;
  }

  function empty(text, href, cta) {
    return `
      <p class="wp-hint">${escapeHtml(text)}</p>
      <a class="wp-btn wp-btn-primary wp-btn-block" href="${href}">${escapeHtml(cta)}</a>
    `;
  }

  function bar(percent) {
    return `<div class="wp-oe-bar wp-arch-bar" aria-hidden="true"><i style="width:${percent}%"></i></div>`;
  }

  // ── 三块内容 ─────────────────────────────
  function discBlock(entry) {
    if (!entry) {
      return `
        <section class="wp-card">
          ${head('三面 · 职业行为风格')}
          ${empty('还没做完 45 题。做完一次，这里会出现你的类型和三状态。', './index.html', '去做三面测评')}
        </section>
      `;
    }

    const info = CONTENT.TYPE_NAMES[entry.code] || {};
    const chips = ['natural', 'work', 'stress']
      .map((stage) => {
        const data = (entry.byStage || {})[stage];
        if (!data || !data.main) return '';
        return `<span class="wp-arch-chip">${STAGE_NAME[stage]} · ${escapeHtml(data.main)}</span>`;
      })
      .join('');

    return `
      <section class="wp-card">
        ${head('三面 · 职业行为风格', entry.createdAt)}
        <div class="wp-arch-code">${escapeHtml(entry.code)}</div>
        <p class="wp-arch-name">${escapeHtml(info.name || '这一型')}${info.line ? ` · ${escapeHtml(info.line)}` : ''}</p>
        <div class="wp-arch-chips">${chips}</div>
        <a class="wp-arch-link" href="./index.html">去首页看完整报告 →</a>
      </section>
    `;
  }

  function oejtsBlock(entry) {
    if (!entry) {
      return `
        <section class="wp-card">
          ${head('16 型人格 · OEJTS')}
          ${empty('还没做过 16 型。32 道题，约 5 分钟。', './oejts.html', '去做 16 型')}
        </section>
      `;
    }

    const info = OEJTS.types[entry.code] || {};
    const dims = entry.dims || {};
    const rows = ['EI', 'SN', 'TF', 'JP']
      .map((key) => {
        const meta = OEJTS.dims[key] || {};
        const data = dims[key] || {};
        const percent = typeof data.percent === 'number' ? data.percent : 50;
        const isRight = data.letter === meta.right;
        const word = isRight ? meta.right : meta.left;
        return `
          <div class="wp-arch-dim">
            <div class="wp-arch-dim-head">
              <span>${escapeHtml(meta.name || key)}</span>
              <span class="wp-arch-dim-pick">${escapeHtml(word || data.letter || '')} · ${percent}%</span>
            </div>
            ${bar(percent)}
          </div>
        `;
      })
      .join('');

    return `
      <section class="wp-card">
        ${head('16 型人格 · OEJTS', entry.createdAt)}
        <div class="wp-arch-code">${escapeHtml(entry.code)}</div>
        <p class="wp-arch-name">${escapeHtml(info.name || '这一型')}</p>
        ${rows}
        <a class="wp-arch-link" href="./oejts.html">看完整结果 / 重测 →</a>
      </section>
    `;
  }

  function readingBlock(entry) {
    if (!entry) {
      return `
        <section class="wp-card">
          ${head('阅读人格 · 微信读书')}
          ${empty('还没录入阅读人格。可以从微信读书插件复制结果，也可以按四组自己划。', './reading.html', '录入阅读人格')}
        </section>
      `;
    }

    const info = READING.types[entry.code] || {};
    const dims = entry.dims || {};
    const rows = READING.dims
      .map((dim) => {
        const data = dims[dim.key] || {};
        const isRight = data.letter === dim.right;
        const word = isRight ? dim.rightWord : dim.leftWord;
        const percent = typeof data.percent === 'number' ? data.percent : 50;
        return `
          <div class="wp-arch-dim">
            <div class="wp-arch-dim-head">
              <span>${escapeHtml(dim.name)}</span>
              <span class="wp-arch-dim-pick">${escapeHtml(word)} · ${percent}%</span>
            </div>
            ${bar(percent)}
          </div>
        `;
      })
      .join('');

    return `
      <section class="wp-card">
        ${head('阅读人格 · 微信读书', entry.createdAt)}
        <div class="wp-arch-code">${escapeHtml(entry.code)}</div>
        <p class="wp-arch-name">${escapeHtml(info.name || '这一型')}${info.line ? ` · ${escapeHtml(info.line)}` : ''}</p>
        ${rows}
        <a class="wp-arch-link" href="./reading.html">重新录入 / 看完整结果 →</a>
      </section>
    `;
  }

  // ── 渲染 ─────────────────────────────────
  function render() {
    const disc = loadDisc();
    const oejts = loadOejts();
    const reading = loadReading();
    const done = [disc, oejts, reading].filter(Boolean).length;

    view.innerHTML = `
      <section class="wp-card wp-oe-hero">
        <p class="wp-eyebrow">人格档案 · 已完成 ${done}/3</p>
        <h2 class="wp-hero-title">三份结果，放在一起</h2>
        <p class="wp-hero-text">三面看你在工作里的行为风格，16 型看日常里的偏好，阅读人格看你怎么读书。这里只把三份并列摆开，不自动替你串结论——哪一份像你、哪里对不上，你自己判断。</p>
      </section>

      ${discBlock(disc)}
      ${oejtsBlock(oejts)}
      ${readingBlock(reading)}

      <section class="wp-card">
        <h3 class="wp-section-title">关于这份档案</h3>
        <ul class="wp-oe-notes">
          <li>三份结果各测各的，量表、题目与计分方式都不同，不能直接换算成同一把尺。</li>
          <li>三面与 16 型是自评问卷；阅读人格来自真实阅读记录。三者都只作自我认识和沟通参考。</li>
          <li>16 型题目来自 OEJTS 1.2（Eric Jorgenson，2015，CC BY-NC-SA 4.0），与 MBTI® 无关；阅读人格参考了 MBTI 的四维结构，不是心理测评。</li>
          <li>数据只存在你自己的浏览器里；登录后会一起同步，可在「数据与隐私」里关闭或清除。</li>
        </ul>
        <a class="wp-btn wp-btn-ghost wp-btn-block" href="./index.html">回三面首页</a>
      </section>
    `;

    log(`档案 三面 ${disc ? disc.code : '无'} ｜16 型 ${oejts ? oejts.code : '无'} ｜阅读 ${reading ? reading.code : '无'}`);
  }

  function init() {
    if (!view) return;
    document.addEventListener('wp:sync-merged', render);
    render();
  }

  init();
})();
