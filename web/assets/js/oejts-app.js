// 16 型人格页面（OEJTS 32 题）：首页 / 答题 / 结果三态，纯前端 + localStorage。
// 与主测评完全独立：题库、计分、存储键都分开，互不影响。
(() => {
  'use strict';

  const QUESTIONS = window.WP_OEJTS_QUESTIONS || [];
  const SCORE = window.WP_OEJTS_SCORE;
  const CONTENT = window.WP_OEJTS_CONTENT || { types: {}, dims: {} };

  const DRAFT_KEY = 'wp_oejts_draft';
  const RESULT_KEY = 'wp_oejts_result';
  const TOTAL = QUESTIONS.length;

  const view = document.getElementById('oejts-view');

  const log = (...args) => console.log('[wp] oejts', ...args);

  let draft = null;
  let currentIndex = null;
  let timer = null;
  let screen = 'home';

  // ── 本地存储 ─────────────────────────────
  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (err) {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (err) {
      log('写入本地失败', key, err);
      return false;
    }
  }

  function loadDraft() {
    const raw = readJSON(DRAFT_KEY, null);
    if (!raw || !raw.answers) return null;
    return { answers: raw.answers, cursor: Number(raw.cursor) || 0, updatedAt: Number(raw.updatedAt) || 0 };
  }

  function saveDraft() {
    if (!draft) return;
    draft.updatedAt = Date.now();
    writeJSON(DRAFT_KEY, { answers: draft.answers, cursor: draft.cursor || 0, updatedAt: draft.updatedAt });
  }

  function loadResult() {
    const raw = readJSON(RESULT_KEY, null);
    return raw && raw.code ? raw : null;
  }

  function syncTouch(force) {
    if (window.WPSync && typeof window.WPSync.touch === 'function') window.WPSync.touch(force);
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

  function clearTimer() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function answeredCount() {
    if (!draft) return 0;
    return QUESTIONS.filter((q) => draft.answers[q.id]).length;
  }

  function firstUnanswered() {
    if (!draft) return 0;
    const index = QUESTIONS.findIndex((q) => !draft.answers[q.id]);
    return index === -1 ? 0 : index;
  }

  function formatDate(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function typeInfo(code) {
    const info = CONTENT.types[code] || {};
    return { name: info.name || '这一型', summary: info.summary || '', watch: info.watch || '' };
  }

  // ── 首页 ─────────────────────────────────
  function startNew() {
    draft = { answers: {}, cursor: 0, updatedAt: Date.now() };
    saveDraft();
    renderQuestion(0);
  }

  function renderHome() {
    clearTimer();
    currentIndex = null;
    screen = 'home';
    draft = loadDraft();

    const answered = answeredCount();
    const result = loadResult();

    const resume = draft && answered > 0 && answered < TOTAL ? `
      <div class="wp-oe-resume">
        <div>
          <p class="wp-oe-resume-title">接着答</p>
          <p class="wp-hint">已答 ${answered}/${TOTAL} 题</p>
        </div>
        <button class="wp-btn wp-btn-primary" id="oe-resume" type="button">继续</button>
      </div>
    ` : '';

    const last = result ? `
      <button class="wp-oe-last" id="oe-last" type="button">
        <span class="wp-oe-last-code">${escapeHtml(result.code)}</span>
        <span class="wp-oe-last-main">
          <strong>${escapeHtml(typeInfo(result.code).name)}</strong>
          <span class="wp-hint">上次结果 · ${formatDate(result.createdAt)}</span>
        </span>
        <span class="wp-oe-last-arrow" aria-hidden="true">→</span>
      </button>
    ` : '';

    view.innerHTML = `
      <section class="wp-card wp-oe-hero">
        <p class="wp-eyebrow">${TOTAL} 题 · 约 5 分钟</p>
        <h2 class="wp-hero-title">16 型人格</h2>
        <p class="wp-hero-text">${escapeHtml(CONTENT.intro || '')}</p>
        <button class="wp-btn wp-btn-primary wp-btn-block" id="oe-start" type="button">
          ${answered > 0 && answered < TOTAL ? '重新开始' : '开始答题'}
        </button>
        ${resume}
      </section>
      ${last}
      <section class="wp-card">
        <h3 class="wp-section-title">先说清楚三件事</h3>
        <ul class="wp-oe-notes">
          <li>题目来自 Open Extended Jungian Type Scales 1.2（作者 Eric Jorgenson，2015），依 <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/" target="_blank" rel="noopener">CC BY-NC-SA 4.0</a> 许可使用；中文译文由本站翻译，同样以该许可提供。</li>
          <li>它和 MBTI® 没有任何关系，也不是心理学诊断，只作自我认识和沟通参考。</li>
          <li>结果只存在你自己的浏览器里，不做招聘、晋升或评价依据。</li>
        </ul>
      </section>
    `;

    document.getElementById('oe-start').addEventListener('click', () => {
      if (answered > 0 && answered < TOTAL && !window.confirm('重新开始会清掉现在已答的内容，确定吗？')) return;
      startNew();
    });

    const resumeBtn = document.getElementById('oe-resume');
    if (resumeBtn) {
      resumeBtn.addEventListener('click', () => renderQuestion(firstUnanswered()));
    }

    const lastBtn = document.getElementById('oe-last');
    if (lastBtn) {
      lastBtn.addEventListener('click', () => renderResult(result));
    }
  }

  // ── 答题 ─────────────────────────────────
  function renderQuestion(index) {
    clearTimer();

    const q = QUESTIONS[index];
    if (!q) {
      finish();
      return;
    }
    if (!draft) {
      startNew();
      return;
    }

    currentIndex = index;
    screen = 'quiz';
    draft.cursor = index;
    saveDraft();

    const value = draft.answers[q.id] || 0;
    const progress = Math.round(answeredCount() / TOTAL * 100);

    view.innerHTML = `
      <section class="wp-quiz">
        <div class="wp-quiz-top">
          <button class="wp-link wp-link-back" id="oe-back" type="button" ${index === 0 ? 'disabled' : ''}>← 上一题</button>
          <button class="wp-link wp-link-exit" id="oe-exit" type="button">退出</button>
        </div>

        <div class="wp-progress" aria-hidden="true"><i style="width:${progress}%"></i></div>
        <p class="wp-quiz-meta">第 ${index + 1}/${TOTAL} 题</p>

        <p class="wp-question-tip">哪边更像你？</p>
        <div class="wp-oe-pair">
          <p class="wp-oe-end">${escapeHtml(q.left)}</p>
          <p class="wp-oe-end">${escapeHtml(q.right)}</p>
        </div>

        <div class="wp-oe-dots" id="oe-dots" role="group" aria-label="第 ${index + 1} 题，选 1 到 5">
          ${[1, 2, 3, 4, 5].map((v) => `
            <button class="wp-oe-dot ${value === v ? 'is-active' : ''}" type="button"
                    data-v="${v}" aria-label="${v} 分" aria-pressed="${value === v}">${v}</button>
          `).join('')}
        </div>
        <div class="wp-oe-dots-legend">
          <span>1 更靠左</span>
          <span>3 差不多</span>
          <span>5 更靠右</span>
        </div>

        <button class="wp-btn wp-btn-primary wp-btn-block" id="oe-next" type="button" ${value ? '' : 'disabled'}>
          ${index === TOTAL - 1 ? '看结果' : '下一题'}
        </button>
      </section>
    `;

    document.getElementById('oe-back').addEventListener('click', () => {
      if (currentIndex > 0) renderQuestion(currentIndex - 1);
    });

    document.getElementById('oe-exit').addEventListener('click', () => {
      if (answeredCount() > 0) saveDraft();
      renderHome();
    });

    document.getElementById('oe-dots').addEventListener('click', (event) => {
      const dot = event.target.closest('[data-v]');
      if (!dot) return;
      pick(q, Number(dot.dataset.v));
    });

    document.getElementById('oe-next').addEventListener('click', () => {
      if (!draft.answers[q.id]) return;
      advance();
    });
  }

  function pick(q, value) {
    draft.answers[q.id] = value;
    saveDraft();
    syncTouch();

    const dots = document.getElementById('oe-dots');
    if (dots) {
      dots.querySelectorAll('[data-v]').forEach((el) => {
        const on = Number(el.dataset.v) === value;
        el.classList.toggle('is-active', on);
        el.setAttribute('aria-pressed', String(on));
      });
    }
    const next = document.getElementById('oe-next');
    if (next) next.disabled = false;

    // 选完稍等一下自动进入下一题，留出「改主意」的时间
    clearTimer();
    timer = setTimeout(() => {
      if (currentIndex === null) return;
      advance();
    }, 260);
  }

  function advance() {
    clearTimer();
    if (currentIndex === null) return;
    if (currentIndex >= TOTAL - 1) {
      finish();
      return;
    }
    renderQuestion(currentIndex + 1);
  }

  // ── 结果 ─────────────────────────────────
  function finish() {
    clearTimer();
    if (!draft) return;

    const result = SCORE.scoreAll(QUESTIONS, draft.answers);
    if (!result.complete) {
      renderHome();
      return;
    }

    const entry = {
      code: result.code,
      dims: result.dims,
      createdAt: new Date().toISOString()
    };
    writeJSON(RESULT_KEY, entry);
    syncTouch(true);
    log('结果', entry.code);
    renderResult(entry);
  }

  function renderResult(entry) {
    clearTimer();
    currentIndex = null;
    screen = 'result';
    draft = loadDraft();

    const info = typeInfo(entry.code);
    const dims = entry.dims || {};

    const rows = SCORE.DIMS.map((dim) => {
      const data = dims[dim.key] || { letter: '', percent: 50 };
      const meta = CONTENT.dims[dim.key] || {};
      const percent = data.percent == null ? 50 : data.percent;
      const isRight = data.letter === dim.right;
      const text = isRight ? meta.rightText : meta.leftText;
      return `
        <div class="wp-oe-meter">
          <div class="wp-oe-meter-head">
            <span class="wp-oe-meter-name">${escapeHtml(meta.name || dim.name)}</span>
            <span class="wp-oe-meter-pick">${escapeHtml(configName(meta, data.letter))} · ${percent}%</span>
          </div>
          <div class="wp-oe-bar" aria-hidden="true">
            <i style="width:${percent}%"></i>
          </div>
          <div class="wp-oe-meter-end">
            <span>${escapeHtml(meta.left || dim.leftName)}</span>
            <span>${escapeHtml(meta.right || dim.rightName)}</span>
          </div>
          <p class="wp-oe-meter-text">${escapeHtml(text || '')}</p>
        </div>
      `;
    }).join('');

    view.innerHTML = `
      <section class="wp-card wp-oe-result">
        <p class="wp-eyebrow">你的 16 型 · ${formatDate(entry.createdAt)}</p>
        <div class="wp-oe-code">${escapeHtml(entry.code)}</div>
        <h2 class="wp-oe-type-name">${escapeHtml(info.name)}</h2>
        <p class="wp-oe-summary">${escapeHtml(info.summary)}</p>
        <p class="wp-oe-watch"><strong>要留意的代价：</strong>${escapeHtml(info.watch)}</p>
      </section>

      <section class="wp-card">
        <h3 class="wp-section-title">四个维度怎么看</h3>
        ${rows}
      </section>

      <section class="wp-card">
        <h3 class="wp-section-title">这份结果怎么用</h3>
        <ul class="wp-oe-notes">
          <li>四分法只说明「更常这样」，不是能力高低，也没有好坏。</li>
          <li>换环境、换阶段，答案可能变；隔一段时间重测，对比着看更有意思。</li>
          <li>题目来源：Open Extended Jungian Type Scales 1.2（Eric Jorgenson，2015，<a href="https://creativecommons.org/licenses/by-nc-sa/4.0/" target="_blank" rel="noopener">CC BY-NC-SA 4.0</a>）；本站与 MBTI® 无关，结果不构成心理诊断或医疗建议。</li>
        </ul>
        <div class="wp-oe-actions">
          <button class="wp-btn wp-btn-primary wp-btn-block" id="oe-again" type="button">再测一次</button>
          <button class="wp-btn wp-btn-ghost wp-btn-block" id="oe-home" type="button">回首页</button>
        </div>
      </section>
    `;

    document.getElementById('oe-again').addEventListener('click', () => {
      if (!window.confirm('重新开始会清掉这次的作答，确定吗？')) return;
      startNew();
    });
    document.getElementById('oe-home').addEventListener('click', renderHome);

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function configName(meta, letter) {
    if (!meta) return letter;
    if (String(meta.left || '').indexOf(letter) !== -1) return meta.left;
    if (String(meta.right || '').indexOf(letter) !== -1) return meta.right;
    return letter;
  }

  // ── 启动 ─────────────────────────────────
  function init() {
    if (!view) return;
    if (!QUESTIONS.length || !SCORE || !CONTENT.types) {
      view.innerHTML = '<section class="wp-card"><p>题库没有加载，请刷新页面重试。</p></section>';
      return;
    }
    draft = loadDraft();
    log('题库', TOTAL, '题', '｜草稿', draft ? `${answeredCount()} 题` : '无');

    // 云端合并回来的草稿 / 结果：停在首页时重绘一次
    document.addEventListener('wp:sync-merged', () => {
      if (screen === 'home') renderHome();
    });

    renderHome();
  }

  init();
})();
