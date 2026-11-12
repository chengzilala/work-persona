// 入口逻辑：首页 → 答题 → 阶段反馈 → 报告；草稿自动保存、可续答。
(() => {
  'use strict';

  const QUESTIONS = window.WP_QUESTIONS || [];
  const CONTENT = window.WP_CONTENT || {};
  const SCORE = window.WP_SCORE;

  const KEYS = {
    draft: 'wp_draft',
    history: 'wp_history',
    settings: 'wp_settings',
    kbRefs: 'wp_kb_refs'
  };
  const DRAFT_VERSION = 1;
  const HISTORY_VERSION = 1;
  const HISTORY_LIMIT = 50;
  const STAGES = {
    natural: { label: '自然状态', next: 'work' },
    work: { label: '工作状态', next: 'stress' },
    stress: { label: '压力状态', next: null }
  };
  const STAGE_ORDER = ['natural', 'work', 'stress'];

  const view = document.getElementById('wp-view');
  let draft = null;
  let currentIndex = null;
  let autoTimer = null;
  let autoTick = null;
  let syncCardOff = null;

  const log = (...args) => console.log('[wp]', ...args);

  // 清掉「自动跳转」的倒计时（切题 / 回首页 / 改选时都要停）
  function clearAuto() {
    clearTimeout(autoTimer);
    clearInterval(autoTick);
    autoTimer = null;
    autoTick = null;
  }

  // ── 本地存储 ─────────────────────────────────────
  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (err) {
      log('读取本地数据失败', key, err);
      return fallback;
    }
  }

  // 返回是否写入成功，历史记录需要据此决定是否删除草稿。
  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (err) {
      log('写入本地数据失败', key, err);
      return false;
    }
  }

  function removeKey(key) {
    try {
      localStorage.removeItem(key);
    } catch (err) {
      log('删除本地数据失败', key, err);
    }
  }

  function loadSettings() {
    const data = readJSON(KEYS.settings, null);
    if (!data || typeof data !== 'object') return { nickname: '', updatedAt: 0 };
    return { nickname: String(data.nickname || ''), updatedAt: Number(data.updatedAt) || 0 };
  }

  function saveSettings(next) {
    const merged = { nickname: String(next.nickname || ''), updatedAt: Date.now() };
    writeJSON(KEYS.settings, merged);
    syncTouch();
    return merged;
  }

  // 云端同步（未登录 / 未开启时是空操作，不影响本地流程）
  function syncApi() {
    return window.WPSync || null;
  }

  function syncTouch(force) {
    const api = syncApi();
    if (api && typeof api.touch === 'function') api.touch(Boolean(force));
  }

  // 昵称默认取统一账户名称；未登录或账户不可用时返回空串。
  function getAccountName() {
    const account = window.WPAccount;
    if (!account || typeof account.userReady !== 'function') return Promise.resolve('');
    return account.userReady()
      .then((user) => String((user && user.nickname) || '').trim())
      .catch(() => '');
  }

  function loadDraft() {
    const data = readJSON(KEYS.draft, null);
    if (!data || data.version !== DRAFT_VERSION || typeof data.answers !== 'object') {
      return null;
    }
    return data;
  }

  function saveDraft() {
    if (!draft) return;
    draft.updatedAt = Date.now();
    writeJSON(KEYS.draft, draft);
  }

  // ── 历史记录 ─────────────────────────────────────
  function makeId() {
    return 'wp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  }

  // 过滤脏数据、按时间倒序、只留最新 50 条。
  function cleanHistory(list) {
    if (!Array.isArray(list)) return [];
    return list
      .filter((item) => item && item.id && item.createdAt && item.code && item.byStage)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, HISTORY_LIMIT);
  }

  function loadHistory() {
    return cleanHistory(readJSON(KEYS.history, []));
  }

  // 同 id 去重后写入；写满时只留最新 20 条重试一次，仍失败返回 0。
  function saveHistoryEntry(entry) {
    const rest = loadHistory().filter((item) => item.id !== entry.id);
    const next = [entry].concat(rest).slice(0, HISTORY_LIMIT);
    if (writeJSON(KEYS.history, next)) return next.length;

    const trimmed = next.slice(0, 20);
    if (writeJSON(KEYS.history, trimmed)) return trimmed.length;
    return 0;
  }

  function stageBrief(stageResult) {
    return `${stageResult.main}>${stageResult.secondary}`;
  }

  // ── 答题状态 ─────────────────────────────────────
  function isComplete(q, answer) {
    if (!answer || !answer.most) return false;
    if (q.stage === 'natural') {
      return Boolean(answer.least) && answer.least !== answer.most;
    }
    return true;
  }

  // 按钮文案随作答进度变化，避免「按钮灰着但不知道为什么」。
  function nextLabel(q, answer) {
    if (!answer || !answer.most) return q.stage === 'natural' ? '先选一句「最像」' : '选一句「最像」';
    if (q.stage === 'natural' && !answer.least) return '还差一句「最不像」';
    return '下一题';
  }

  function tipText(q, answer) {
    if (q.stage !== 'natural') return '选最像你的一项。';
    if (!answer || !answer.most) return '先选最像你的一句，再选最不像你的一句。';
    if (!answer.least) return '「最像」已选好，再点一句「最不像」。';
    return '两句都选好了，继续下一题。';
  }

  function answeredCount() {
    if (!draft) return 0;
    return QUESTIONS.filter((q) => isComplete(q, draft.answers[q.id])).length;
  }

  function firstUnanswered() {
    if (!draft) return 0;
    for (let i = 0; i < QUESTIONS.length; i += 1) {
      if (!isComplete(QUESTIONS[i], draft.answers[QUESTIONS[i].id])) return i;
    }
    return QUESTIONS.length;
  }

  function startNew() {
    draft = {
      version: DRAFT_VERSION,
      answers: {},
      cursor: 0,
      stage: 'natural',
      updatedAt: Date.now()
    };
    saveDraft();
    log('开始新测评');
    renderQuestion(0);
  }

  // ── 首页 ─────────────────────────────────────────
  function renderHome() {
    clearAuto();
    currentIndex = null;

    const settings = loadSettings();
    const answered = answeredCount();
    const hasDraft = Boolean(draft) && answered > 0;
    const stageLabel = draft ? (STAGES[draft.stage] || STAGES.natural).label : '';
    const historyCount = loadHistory().length;

    view.innerHTML = `
      <section class="wp-hero">
        <p class="wp-eyebrow">${QUESTIONS.length} 题 · 自然 / 工作 / 压力</p>
        <h2 class="wp-hero-title">你不是一个标签，是三种状态。</h2>
        <p class="wp-hero-text">同一套题，分别看你不加修饰时、进入工作角色后、被压力顶住时的样子。</p>

        <label class="wp-field">
          <span>昵称（可不填）</span>
          <input id="wp-nickname" type="text" maxlength="12" autocomplete="nickname"
                 placeholder="默认显示「我」" value="${escapeAttr(settings.nickname || '')}">
        </label>

        ${hasDraft ? `
          <div class="wp-resume">
            <div class="wp-resume-info">
              <strong>继续上次</strong>
              <p>已答 ${answered}/${QUESTIONS.length} 题 · ${stageLabel}</p>
            </div>
            <button class="wp-btn wp-btn-ghost" id="wp-resume" type="button">继续</button>
          </div>
        ` : ''}

        <button class="wp-btn wp-btn-primary wp-btn-block" id="wp-start" type="button">
          ${hasDraft ? '重新开始' : '开始测评'}
        </button>
        <p class="wp-hint">${hasDraft ? '继续会回到上次的位置；重新开始会清空未完成的作答。' : '答题过程自动保存在本机，随时可以退出。'}</p>

        <button class="wp-btn wp-btn-ghost wp-btn-block wp-history-entry" id="wp-history" type="button"
                ${historyCount ? '' : 'disabled'}>
          ${historyCount ? `历史记录（${historyCount}）` : '历史记录（0）· 暂无历史'}
        </button>
      </section>

      <a class="wp-card wp-next-card" href="./oejts.html">
        <span class="wp-next-main">
          <span class="wp-eyebrow">另一个视角 · 32 题 · 约 5 分钟</span>
          <span class="wp-next-title">16 型人格（OEJTS）</span>
          <span class="wp-next-text">不看工作场景，只看你在日常里更自然的那一面。</span>
        </span>
        <span class="wp-next-arrow" aria-hidden="true">→</span>
      </a>

      <a class="wp-card wp-next-card" href="./profile.html">
        <span class="wp-next-main">
          <span class="wp-eyebrow">三份结果 · 并排看</span>
          <span class="wp-next-title">我的人格档案</span>
          <span class="wp-next-text">三面、16 型、阅读人格放在一页，缺哪份就补哪份。</span>
        </span>
        <span class="wp-next-arrow" aria-hidden="true">→</span>
      </a>

      <section class="wp-card">
        <h3 class="wp-section-title">开始前</h3>
        <ul class="wp-about-list">
          <li>没有标准答案，按第一反应选就好。</li>
          <li>答题过程自动保存在本机，关掉页面也不会丢。</li>
          <li>结果只作自我认知参考，不构成心理诊断或医疗建议。</li>
        </ul>
      </section>

      <div class="wp-data-entry">
        <a class="wp-link" href="./kb.html">参考知识库</a>
        <span class="wp-dot">·</span>
        <button class="wp-link wp-link-exit" id="wp-about" type="button">关于三面</button>
        <span class="wp-dot">·</span>
        <button class="wp-link wp-link-exit" id="wp-data" type="button">数据与隐私</button>
      </div>
    `;

    const nicknameInput = document.getElementById('wp-nickname');
    nicknameInput.addEventListener('input', () => {
      const next = loadSettings();
      next.nickname = nicknameInput.value;
      saveSettings(next);
    });

    getAccountName().then((name) => {
      if (name) nicknameInput.placeholder = `默认显示「${name}」`;
    });

    document.getElementById('wp-start').addEventListener('click', () => {
      if (hasDraft && !window.confirm('重新开始会清空上次未完成的作答，确定吗？')) {
        return;
      }
      startNew();
    });

    const resumeBtn = document.getElementById('wp-resume');
    if (resumeBtn) {
      resumeBtn.addEventListener('click', () => {
        const index = firstUnanswered();
        if (index >= QUESTIONS.length) {
          finish();
          return;
        }
        renderQuestion(index);
      });
    }

    const historyBtn = document.getElementById('wp-history');
    if (historyBtn && !historyBtn.disabled) {
      historyBtn.addEventListener('click', renderHistory);
    }

    document.getElementById('wp-about').addEventListener('click', renderAbout);
    document.getElementById('wp-data').addEventListener('click', renderData);

    log('回到首页', hasDraft ? `草稿 ${answered}/${QUESTIONS.length}` : '无草稿');
  }

  // ── 答题 ─────────────────────────────────────────
  function renderQuestion(index) {
    clearAuto();

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
    draft.cursor = index;
    draft.stage = q.stage;
    saveDraft();

    const answer = draft.answers[q.id] || {};
    const stage = STAGES[q.stage];
    const progress = Math.round(answeredCount() / QUESTIONS.length * 100);

    view.innerHTML = `
      <section class="wp-quiz">
        <div class="wp-quiz-top">
          <button class="wp-link wp-link-back" id="wp-back" type="button" ${index === 0 ? 'disabled' : ''}>← 上一题</button>
          <button class="wp-link wp-link-exit" id="wp-exit" type="button">退出</button>
        </div>

        <div class="wp-progress" aria-hidden="true"><i style="width:${progress}%"></i></div>
        <p class="wp-quiz-meta">第 ${index + 1}/${QUESTIONS.length} 题 · ${stage.label}</p>

        <h2 class="wp-question">${escapeHtml(q.text)}</h2>
        <p class="wp-question-tip" id="wp-tip">${tipText(q, answer)}</p>

        <div class="wp-options" id="wp-options">
          ${q.options.map((opt, i) => optionHTML(q, opt, i, answer)).join('')}
        </div>

        <button class="wp-btn wp-btn-primary wp-btn-block" id="wp-next" type="button"
                ${isComplete(q, answer) ? '' : 'disabled'}>${nextLabel(q, answer)}</button>
      </section>
    `;

    document.getElementById('wp-back').addEventListener('click', () => {
      if (currentIndex > 0) renderQuestion(currentIndex - 1);
    });

    document.getElementById('wp-exit').addEventListener('click', () => {
      renderHome();
    });

    document.getElementById('wp-options').addEventListener('click', (event) => {
      const pickEl = event.target.closest('[data-pick]');
      if (!pickEl) return;
      const option = q.options[Number(pickEl.dataset.i)];
      if (!option) return;
      pickAnswer(q, option, pickEl.dataset.pick);
    });

    document.getElementById('wp-next').addEventListener('click', () => {
      if (!isComplete(q, draft.answers[q.id])) return;
      advanceFrom(currentIndex);
    });
  }

  function optionHTML(q, opt, index, answer) {
    const isNatural = q.stage === 'natural';
    const text = escapeHtml(opt.text);

    if (!isNatural) {
      const selected = answer.most === opt.dim;
      return `
        <button class="wp-option wp-option-button ${selected ? 'is-selected' : ''}"
                type="button" data-pick="most" data-i="${index}">
          <span class="wp-option-text">${text}</span>
        </button>
      `;
    }

    const most = answer.most === opt.dim;
    const least = answer.least === opt.dim;
    return `
      <div class="wp-option ${most ? 'is-most' : ''} ${least ? 'is-least' : ''}" data-i="${index}">
        <p class="wp-option-text">${text}</p>
        <div class="wp-option-actions">
          <button class="wp-chip ${most ? 'is-active' : ''}" type="button" data-pick="most" data-i="${index}">最像</button>
          <button class="wp-chip ${least ? 'is-active' : ''}" type="button" data-pick="least" data-i="${index}">最不像</button>
        </div>
      </div>
    `;
  }

  function pickAnswer(q, option, pick) {
    if (!draft) return;
    const answer = draft.answers[q.id] || {};

    if (pick === 'least') {
      if (answer.most === option.dim) answer.most = '';
      answer.least = option.dim;
    } else {
      if (answer.least === option.dim) answer.least = '';
      answer.most = option.dim;
    }

    draft.answers[q.id] = answer;
    saveDraft();
    refreshQuestionUI(q, answer);

    // 答题中草稿：每 5 题强制推一次，其余交给同步模块按 60 秒节流
    const done = answeredCount();
    syncTouch(done % 5 === 0);

    if (isComplete(q, answer)) {
      scheduleAdvance(currentIndex);
    } else {
      clearAuto();
    }
  }

  function refreshQuestionUI(q, answer) {
    const root = document.getElementById('wp-options');
    if (!root) return;

    root.querySelectorAll('.wp-option').forEach((el) => {
      const option = q.options[Number(el.dataset.i)];
      if (!option) return;
      const isMost = answer.most === option.dim;
      const isLeast = answer.least === option.dim;
      el.classList.toggle('is-most', isMost);
      el.classList.toggle('is-least', isLeast);
      el.classList.toggle('is-selected', q.stage !== 'natural' && isMost);
      el.querySelectorAll('.wp-chip').forEach((chip) => {
        const active = (chip.dataset.pick === 'most' && isMost) ||
          (chip.dataset.pick === 'least' && isLeast);
        chip.classList.toggle('is-active', active);
      });
    });

    const next = document.getElementById('wp-next');
    if (next) {
      next.disabled = !isComplete(q, answer);
      next.textContent = nextLabel(q, answer);
    }

    const tip = document.getElementById('wp-tip');
    if (tip) {
      tip.textContent = tipText(q, answer);
      tip.classList.remove('is-counting');
    }
  }

  function scheduleAdvance(index) {
    clearAuto();

    // 选完给 3 秒：提示里逐秒倒计时，用户可回看 / 改选，也可直接点「下一题」。
    let remain = 3;
    const tip = document.getElementById('wp-tip');

    const paint = () => {
      if (!tip) return;
      tip.textContent = `${remain} 秒后自动进入下一题，也可以直接点「下一题」。`;
      tip.classList.add('is-counting');
    };

    paint();
    autoTick = setInterval(() => {
      remain -= 1;
      if (remain <= 0) {
        // 只停自己，别把负责跳转的定时器一起清掉
        clearInterval(autoTick);
        autoTick = null;
        return;
      }
      paint();
    }, 1000);

    autoTimer = setTimeout(() => {
      clearAuto();
      if (currentIndex !== index) return;
      advanceFrom(index);
    }, 3000);
  }

  function advanceFrom(index) {
    if (index === null || index !== currentIndex) return;
    clearAuto();
    currentIndex = null;

    const q = QUESTIONS[index];
    const next = QUESTIONS[index + 1];

    if (!next) {
      finish();
      return;
    }
    if (next.stage !== q.stage) {
      renderStageDone(q.stage);
      return;
    }
    renderQuestion(index + 1);
  }

  // ── 阶段反馈 ─────────────────────────────────────
  function renderStageDone(stageKey) {
    clearAuto();
    currentIndex = null;

    const nextStage = STAGES[stageKey].next;
    const nextIndex = QUESTIONS.findIndex((q) => q.stage === nextStage);
    const isNatural = stageKey === 'natural';

    view.innerHTML = `
      <section class="wp-card wp-stage-done">
        <p class="wp-eyebrow">已完成 ${isNatural ? '1' : '2'}/3</p>
        <h2 class="wp-hero-title">${isNatural ? '自然状态答完了' : '工作状态答完了'}</h2>
        <p class="wp-hero-text">${isNatural
          ? '接下来是工作状态 12 题。想想你上班时的通常做法，不用想太久。'
          : '最后 6 题。想想被压力顶住时，你真实的第一反应。'}</p>
        <button class="wp-btn wp-btn-primary wp-btn-block" id="wp-continue" type="button">进入下一段</button>
      </section>
    `;

    document.getElementById('wp-continue').addEventListener('click', () => {
      draft.cursor = nextIndex;
      draft.stage = nextStage;
      saveDraft();
      renderQuestion(nextIndex);
    });
  }

  // ── 完成与报告 ───────────────────────────────────
  function finish() {
    if (!draft) {
      renderHome();
      return;
    }

    const allDone = QUESTIONS.every((q) => isComplete(q, draft.answers[q.id]));
    if (!allDone) {
      const index = firstUnanswered();
      renderQuestion(index >= QUESTIONS.length ? 0 : index);
      return;
    }

    if (!SCORE) {
      view.innerHTML = '<section class="wp-card"><p>计分模块没有加载，请刷新页面重试。</p></section>';
      return;
    }

    const result = SCORE.scoreAll(QUESTIONS, draft.answers);
    const settings = loadSettings();
    const typedNickname = (settings.nickname || '').trim();

    getAccountName().then((accountName) => {
      const entry = {
        schemaVersion: HISTORY_VERSION,
        id: makeId(),
        createdAt: new Date().toISOString(),
        nickname: typedNickname || accountName || '我',
        ...result
      };

      const savedCount = saveHistoryEntry(entry);
      if (!savedCount) {
        // 写入失败时保留草稿，报告照常展示，并提供重试入口。
        log('历史写入失败，草稿已保留');
        renderReport(entry, { saveFailed: true });
        return;
      }

      removeKey(KEYS.draft);
      draft = null;

      log('测评完成', entry.code, `历史 ${savedCount} 条`);
      syncTouch(true);
      renderReport(entry);
    });
  }

  // ── 报告图形（内联 SVG，零依赖） ─────────────────
  const DIMS = ['D', 'I', 'S', 'C'];
  const STAGE_COLOR = { natural: '#2f6fed', work: '#12a594', stress: '#e5533d' };
  const AVATAR_BG = { D: '#ffe9e3', I: '#fff4d9', S: '#e4f5ec', C: '#e9effc' };
  const AVATAR_INK = '#1f2329';
  const DIM_COLOR = { D: '#e5533d', I: '#e8a317', S: '#12a594', C: '#2f6fed' };

  function avatarHair(dim) {
    if (dim === 'D') {
      return `<path d="M29 42c0-12 8-21 19-21s19 9 19 21c-2-7-7-10-11-10-4 0-5 3-8 3s-5-3-9-3c-4 0-8 4-10 10z" fill="${AVATAR_INK}"/>`;
    }
    if (dim === 'I') {
      return `<g fill="${AVATAR_INK}"><circle cx="34" cy="30" r="8"/><circle cx="46" cy="24" r="9"/><circle cx="58" cy="27" r="8"/><circle cx="65" cy="36" r="6"/></g>`;
    }
    if (dim === 'S') {
      return `<path d="M30 41c0-11 8-19 18-19s18 8 18 19c-5-5-11-7-18-7s-13 2-18 7z" fill="${AVATAR_INK}"/>`;
    }
    return `<path d="M47 23c-10 1-17 8-17 19 2-5 5-8 9-9 4-1 7-1 8 1z" fill="${AVATAR_INK}"/>
      <path d="M49 23c10 1 17 8 17 19-2-5-5-8-9-9-4-1-7-1-8 1z" fill="${AVATAR_INK}"/>`;
  }

  function avatarBadge(dim) {
    const color = { D: '#e5533d', I: '#e8a317', S: '#12a594', C: '#2f6fed' }[dim];
    const icon = {
      D: `<path d="M75 64l-6 8h4l-2 8 7-10h-4z" fill="${color}"/>`,
      I: `<path d="M66 65h16v10h-9l-4 4v-4h-3z" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>`,
      S: `<path d="M74 63l7 3v6c0 4-3 7-7 8-4-1-7-4-7-8v-6z" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>`,
      C: `<circle cx="73" cy="69" r="5.5" fill="none" stroke="${color}" stroke-width="2"/><path d="M77 73l4.5 4.5" stroke="${color}" stroke-width="2" stroke-linecap="round"/>`
    }[dim];
    return `<circle cx="74" cy="72" r="14" fill="#fff" stroke="${color}" stroke-width="1.5"/>${icon}`;
  }

  // 12 组类型各一款简笔画头像：发型看主维，右下角印记看次维
  function avatarSVG(code) {
    const main = code[0] || 'D';
    const second = code[1] || 'I';
    const clipId = `wp-face-${code}`;
    return `
      <svg class="wp-avatar" viewBox="0 0 96 96" role="img" aria-label="${code} 类型简笔画头像">
        <defs><clipPath id="${clipId}"><rect width="96" height="96" rx="28"/></clipPath></defs>
        <g clip-path="url(#${clipId})">
          <rect width="96" height="96" fill="${AVATAR_BG[main] || AVATAR_BG.D}"/>
          <path d="M14 96c2-15 15-23 34-23s32 8 34 23z" fill="#fff" stroke="${AVATAR_INK}" stroke-width="2.5"/>
          <circle cx="48" cy="42" r="19" fill="#fff" stroke="${AVATAR_INK}" stroke-width="2.5"/>
          ${avatarHair(main)}
          ${main === 'C'
            ? `<g fill="none" stroke="${AVATAR_INK}" stroke-width="2"><circle cx="41" cy="44" r="6"/><circle cx="56" cy="44" r="6"/><path d="M47 44h3"/></g>
               <circle cx="41" cy="44" r="2" fill="${AVATAR_INK}"/><circle cx="56" cy="44" r="2" fill="${AVATAR_INK}"/>`
            : `<circle cx="41" cy="43" r="2.2" fill="${AVATAR_INK}"/><circle cx="55" cy="43" r="2.2" fill="${AVATAR_INK}"/>`}
          <path d="M43 52q5 4 10 0" fill="none" stroke="${AVATAR_INK}" stroke-width="2" stroke-linecap="round"/>
        </g>
        ${avatarBadge(second)}
      </svg>
    `;
  }

  // 单状态 DISC 折线图：四个维度各一个点，连成一条线
  function chartSVG(stage, score) {
    const W = 320;
    const H = 156;
    const padX = 34;
    const padTop = 24;
    const padBottom = 34;
    const color = STAGE_COLOR[stage];
    const step = (W - padX * 2) / (DIMS.length - 1);
    const toY = (value) => padTop + (100 - value) / 100 * (H - padTop - padBottom);
    const points = DIMS.map((dim, i) => ({ dim, value: score[dim], x: padX + step * i, y: toY(score[dim]) }));
    const line = points.map((p) => `${p.x},${p.y}`).join(' ');
    // 只留 0 / 50 / 100 三条极淡的参考线，避免画面过密
    const grid = [0, 50, 100].map((v) => `<line x1="${padX - 8}" y1="${toY(v)}" x2="${W - padX + 8}" y2="${toY(v)}" stroke="#f2f4f7" stroke-width="1"/>`).join('');

    return `
      <svg class="wp-chart" viewBox="0 0 ${W} ${H}" role="img"
           aria-label="${stage} 状态 D${score.D} I${score.I} S${score.S} C${score.C}">
        ${grid}
        <polyline points="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
        ${points.map((p) => `
          <circle cx="${p.x}" cy="${p.y}" r="4.5" fill="#fff" stroke="${color}" stroke-width="2.5"/>
          <text x="${p.x}" y="${Math.max(p.y - 11, 12)}" text-anchor="middle" class="wp-chart-value">${p.value}</text>
          <text x="${p.x}" y="${H - 10}" text-anchor="middle" class="wp-chart-axis">${p.dim}</text>
        `).join('')}
      </svg>
    `;
  }

  function renderReport(entry, options) {
    const opts = options || {};
    clearAuto();
    currentIndex = null;

    const type = (CONTENT.TYPE_NAMES || {})[entry.code] || { name: entry.code, line: '' };
    const figure = (CONTENT.FIGURES || {})[entry.code] || null;
    const features = buildFeatures(entry, type);
    const stages = STAGE_ORDER.map((stage) => {
      const result = entry.byStage[stage];
      return {
        key: stage,
        label: STAGES[stage].label,
        main: result.main,
        mainName: CONTENT.DIMS[result.main].name,
        score: result.score,
        text: buildStateProfile(stage, result.main, result.secondary)
      };
    });
    const mask = buildShiftReading('naturalWork', entry.shifts.naturalWork);
    const pressure = buildShiftReading('workStress', entry.shifts.workStress);

    view.innerHTML = `
      ${opts.fromHistory ? `
        <div class="wp-history-head">
          <button class="wp-link" id="wp-report-back" type="button">← 回到历史</button>
        </div>
      ` : ''}
      <section class="wp-report">
        ${opts.saveFailed ? `
          <section class="wp-card wp-save-warn">
            <h3 class="wp-section-title">结果没能存进历史</h3>
            <p class="wp-profile">本机存储可能已满，草稿还留着。清出一点空间后可以重试。</p>
            <button class="wp-btn wp-btn-ghost" id="wp-retry-save" type="button">重试保存</button>
          </section>
        ` : ''}
        <header class="wp-report-hero">
          <div class="wp-report-top">
            <div class="wp-report-crest">
              <div class="wp-report-face">${avatarSVG(entry.code)}</div>
              <div class="wp-report-seal">${entry.code}</div>
            </div>
            <div class="wp-report-id">
              <p class="wp-eyebrow">${formatDate(entry.createdAt)} · 三面报告</p>
              <h2 class="wp-report-name">${escapeHtml(entry.nickname)}</h2>
              <p class="wp-report-type"><b>${escapeHtml(type.name)}</b></p>
              <p class="wp-report-line">${escapeHtml(type.line)}</p>
            </div>
          </div>
          ${figure ? `
            <div class="wp-report-figure">
              <p class="wp-report-figure-label">这类人的职场熟面孔</p>
              <p class="wp-figure-name">${escapeHtml(figure.name)}<span>${escapeHtml(figure.org)}</span></p>
              <p class="wp-figure-why">${escapeHtml(figure.why)}</p>
              <p class="wp-figure-note">仅作气质联想，不是对这位人物的测评或评价。</p>
            </div>
          ` : ''}
        </header>

        ${opts.fromHistory ? compareCard(opts.previous, entry) : ''}

        <div class="wp-state-row">
          ${stages.map((stage) => `
            <div class="wp-state-pill is-${stage.key}">
              <span class="wp-state-pill-label">${stage.label}</span>
              <span class="wp-state-pill-main">${stage.main}<i>${stage.mainName}</i></span>
              <span class="wp-state-pill-score">${stage.score[stage.main]}</span>
            </div>
          `).join('')}
        </div>

        <section class="wp-card">
          <h3 class="wp-section-title">综合特征</h3>
          <ul class="wp-feature-list">
            ${features.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
          </ul>
        </section>

        ${stages.map((stage) => `
          <section class="wp-card wp-state-card is-${stage.key}">
            <div class="wp-state-head">
              <span class="wp-state-dot"></span>
              <h3 class="wp-section-title">${stage.label}的你</h3>
              <span class="wp-state-code">${stage.main} · ${stage.mainName}</span>
            </div>
            ${chartSVG(stage.key, stage.score)}
            <p class="wp-profile">${escapeHtml(stage.text)}</p>
          </section>
        `).join('')}

        <section class="wp-card">
          <h3 class="wp-section-title">状态之间的位移</h3>
          <div class="wp-shift">
            <p class="wp-shift-label">自然 → 工作</p>
            <p class="wp-shift-text">${escapeHtml(mask)}</p>
          </div>
          <div class="wp-shift">
            <p class="wp-shift-label">工作 → 压力</p>
            <p class="wp-shift-text">${escapeHtml(pressure)}</p>
          </div>
        </section>

        <section class="wp-card">
          <h3 class="wp-section-title">D · I · S · C 分别代表</h3>
          <ul class="wp-dim-grid">
            ${Object.keys(CONTENT.DIMS || {}).map((key) => {
              const dim = CONTENT.DIMS[key];
              const detail = (CONTENT.DIM_DETAILS || {})[key];
              return `
                <li class="wp-dim-item">
                  <span class="wp-dim-key">${key}</span>
                  <span class="wp-dim-body">
                    <strong>${dim.name} · ${dim.keyword}</strong>
                    <em>${escapeHtml(dim.desc)}</em>
                    ${detail ? `
                      <span class="wp-dim-detail" hidden>
                        <span class="wp-dim-label">生活里的你</span>
                        <span class="wp-dim-text">${escapeHtml(detail.life)}</span>
                        <span class="wp-dim-label">这个说法从哪来</span>
                        <span class="wp-dim-text">${escapeHtml(detail.origin)}</span>
                        <span class="wp-dim-label">参考来源</span>
                        ${(detail.sources || []).map((source) => `
                          <a class="wp-dim-source" href="./kb.html?ref=${encodeURIComponent(source.refId || '')}">
                            <span>${escapeHtml(source.label)}</span><i>站内打开 ›</i>
                          </a>
                        `).join('')}
                        <span class="wp-dim-note">${escapeHtml(CONTENT.SOURCE_NOTE || '')}</span>
                      </span>
                    ` : ''}
                  </span>
                  ${detail ? '<button class="wp-dim-toggle" type="button" aria-expanded="false">展开</button>' : ''}
                </li>
              `;
            }).join('')}
          </ul>
        </section>

        <section class="wp-card wp-disclaimer">
          <h3 class="wp-section-title">特别说明</h3>
          <ul class="wp-about-list">
            ${(CONTENT.DISCLAIMER || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
          </ul>
        </section>

        <div class="wp-actions">
          <button class="wp-btn wp-btn-primary" id="wp-again" type="button">再测一次</button>
          <button class="wp-btn wp-btn-ghost" id="wp-share" type="button">生成分享图</button>
          <button class="wp-btn wp-btn-ghost" id="wp-home" type="button">回到首页</button>
          ${opts.fromHistory ? '' : '<button class="wp-btn wp-btn-ghost" id="wp-history-list" type="button">查看历史</button>'}
        </div>
      </section>
    `;

    document.getElementById('wp-again').addEventListener('click', startNew);
    document.getElementById('wp-home').addEventListener('click', renderHome);
    document.getElementById('wp-share').addEventListener('click', () => shareReport(entry));

    const backBtn = document.getElementById('wp-report-back');
    if (backBtn) backBtn.addEventListener('click', renderHistory);

    const listBtn = document.getElementById('wp-history-list');
    if (listBtn) listBtn.addEventListener('click', renderHistory);

    view.querySelectorAll('.wp-dim-toggle').forEach((btn) => {
      btn.addEventListener('click', () => {
        const detail = btn.parentElement.querySelector('.wp-dim-detail');
        if (!detail) return;
        const open = detail.hidden;
        detail.hidden = !open;
        btn.textContent = open ? '收起' : '展开';
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    });

    const retryBtn = document.getElementById('wp-retry-save');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => {
        const savedCount = saveHistoryEntry(entry);
        if (!savedCount) {
          window.alert('还是没存进去。可以先保留草稿，清理本机空间后再试。');
          return;
        }
        removeKey(KEYS.draft);
        draft = null;
        log('重试保存成功', entry.code, `历史 ${savedCount} 条`);
        renderReport(entry);
      });
    }
  }

  // ── 分享图（Canvas 2D，零依赖）─────────────────────
  function roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function wrapCanvasText(ctx, text, maxWidth) {
    const lines = [];
    let line = '';
    String(text || '').split('').forEach((ch) => {
      const test = line + ch;
      if (line && ctx.measureText(test).width > maxWidth) {
        lines.push(line);
        line = ch;
      } else {
        line = test;
      }
    });
    if (line) lines.push(line);
    return lines;
  }

  function drawShareChart(ctx, x, y, w, h, stage, score, font) {
    const color = STAGE_COLOR[stage];
    roundRectPath(ctx, x, y, w, h, 24);
    ctx.fillStyle = '#f8f9fb';
    ctx.fill();

    ctx.textAlign = 'left';
    ctx.fillStyle = '#6b7280';
    ctx.font = font(26);
    ctx.fillText(STAGES[stage].label, x + 24, y + 46);

    const padX = 34;
    const top = y + 78;
    const bottom = y + h - 54;
    const step = (w - padX * 2) / (DIMS.length - 1);
    const toY = (value) => top + ((100 - value) / 100) * (bottom - top);
    const points = DIMS.map((dim, i) => [x + padX + step * i, toY(score[dim])]);

    ctx.strokeStyle = '#e9ecf2';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + padX - 12, bottom);
    ctx.lineTo(x + w - padX + 12, bottom);
    ctx.stroke();

    ctx.strokeStyle = color;
    ctx.lineWidth = 5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    points.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.stroke();

    points.forEach(([px, py], i) => {
      ctx.beginPath();
      ctx.arc(px, py, 8, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.fillStyle = '#6b7280';
      ctx.font = font(20);
      ctx.fillText(DIMS[i], px, y + h - 18);
    });
  }

  // 把内联 SVG 头像转成图片，供 Canvas 绘制（失败时返回 null，退化为色块）
  function loadAvatarImage(code) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      // 独立 SVG 文件必须带 xmlns，否则图片解析失败
      const svg = avatarSVG(code).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
  }

  async function buildShareCanvas(entry) {
    const W = 1080;
    const H = 1920;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    const font = (size, weight) => `${weight || 400} ${size}px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`;
    const type = (CONTENT.TYPE_NAMES || {})[entry.code] || { name: entry.code, line: '' };
    const figure = (CONTENT.FIGURES || {})[entry.code];
    const avatar = await loadAvatarImage(entry.code);

    ctx.fillStyle = '#f6f7f9';
    ctx.fillRect(0, 0, W, H);
    roundRectPath(ctx, 36, 36, W - 72, H - 72, 48);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    // 品牌 + 日期
    ctx.textAlign = 'left';
    ctx.fillStyle = '#1f2329';
    ctx.font = font(48, 700);
    ctx.fillText('三面', 120, 164);

    // 字标下的三格刻度：自然 / 工作 / 压力，等大等距
    ctx.strokeStyle = '#d7dbe2';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(120, 184.5);
    ctx.lineTo(216, 184.5);
    ctx.stroke();
    ctx.fillStyle = 'rgba(47, 111, 237, .65)';
    [136, 168, 200].forEach((x) => ctx.fillRect(x - 0.75, 184, 1.5, 6));

    ctx.textAlign = 'right';
    ctx.fillStyle = '#6b7280';
    ctx.font = font(26);
    ctx.fillText('职业行为风格测评', W - 120, 158);

    ctx.textAlign = 'left';
    ctx.fillStyle = '#2f6fed';
    ctx.font = font(26, 500);
    ctx.fillText(formatDate(entry.createdAt), 120, 236);

    // 头像 + 类型代码 / 名称 / 一句话
    if (avatar) {
      ctx.save();
      roundRectPath(ctx, 120, 280, 292, 292, 84);
      ctx.clip();
      ctx.drawImage(avatar, 120, 280, 292, 292);
      ctx.restore();
      roundRectPath(ctx, 120, 280, 292, 292, 84);
      ctx.strokeStyle = 'rgba(31, 35, 41, .08)';
      ctx.lineWidth = 2;
      ctx.stroke();
    } else {
      roundRectPath(ctx, 120, 280, 292, 292, 84);
      ctx.fillStyle = AVATAR_BG[entry.code[0]] || AVATAR_BG.D;
      ctx.fill();
    }

    ctx.textAlign = 'left';
    ctx.fillStyle = '#1f2329';
    ctx.font = font(138, 700);
    ctx.fillText(entry.code, 448, 398);
    const codeWidth = ctx.measureText(entry.code).width;
    ctx.font = font(60, 600);
    ctx.fillText(type.name, 448 + codeWidth + 26, 394);

    ctx.fillStyle = '#6b7280';
    ctx.font = font(32);
    let lineY = 476;
    wrapCanvasText(ctx, type.line, 500).slice(0, 2).forEach((line) => {
      ctx.fillText(line, 450, lineY);
      lineY += 46;
    });

    // 三状态折线图 + 主维分数
    ctx.fillStyle = '#1f2329';
    ctx.font = font(32, 600);
    ctx.fillText('三种状态的你', 120, 636);

    STAGE_ORDER.forEach((stage, index) => {
      const x = 120 + index * 288;
      const stageData = entry.byStage[stage];
      drawShareChart(ctx, x, 662, 264, 210, stage, stageData.score, font);
      const main = stageData.main;
      ctx.textAlign = 'left';
      ctx.fillStyle = STAGE_COLOR[stage];
      ctx.font = font(24, 500);
      ctx.fillText(`${main} ${(CONTENT.DIMS[main] || {}).name || ''} · ${stageData.score[main]}`, x + 4, 906);
    });

    // 这类人的职场熟面孔
    ctx.textAlign = 'left';
    ctx.fillStyle = '#1f2329';
    ctx.font = font(32, 600);
    ctx.fillText('这类人的职场熟面孔', 120, 990);

    if (figure) {
      ctx.font = font(40, 600);
      ctx.fillText(figure.name, 120, 1050);
      const nameWidth = ctx.measureText(figure.name).width;
      ctx.font = font(24);
      ctx.fillStyle = '#6b7280';
      ctx.fillText(figure.org, 120 + nameWidth + 16, 1050);

      ctx.fillStyle = '#4b5563';
      ctx.font = font(28);
      let figureY = 1102;
      wrapCanvasText(ctx, figure.why, 840).slice(0, 3).forEach((line) => {
        ctx.fillText(line, 120, figureY);
        figureY += 42;
      });

      ctx.fillStyle = '#9aa1ad';
      ctx.font = font(20);
      ctx.fillText('仅作气质联想，不是对这位人物的测评或评价。', 120, figureY + 18);
    }

    // 三个特点
    ctx.fillStyle = '#1f2329';
    ctx.font = font(32, 600);
    ctx.fillText('你的三个特点', 120, 1300);

    let y = 1358;
    ctx.font = font(30);
    buildFeatures(entry, type).slice(0, 3).forEach((text) => {
      const lines = wrapCanvasText(ctx, text, 840).slice(0, 2);
      ctx.fillStyle = '#2f6fed';
      ctx.beginPath();
      ctx.arc(126, y - 10, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1f2329';
      lines.forEach((line) => {
        ctx.fillText(line, 152, y);
        y += 46;
      });
      y += 12;
    });

    // 自然状态四维速览
    const naturalScore = entry.byStage.natural.score;
    DIMS.forEach((dim, index) => {
      const x = 120 + index * 212;
      const w = 196;
      roundRectPath(ctx, x, 1570, w, 80, 20);
      ctx.fillStyle = '#f8f9fb';
      ctx.fill();

      ctx.textAlign = 'left';
      ctx.fillStyle = DIM_COLOR[dim];
      ctx.font = font(30, 700);
      ctx.fillText(dim, x + 18, 1620);
      ctx.fillStyle = '#6b7280';
      ctx.font = font(20);
      ctx.fillText((CONTENT.DIMS[dim] || {}).name || '', x + 52, 1618);

      ctx.textAlign = 'right';
      ctx.fillStyle = '#1f2329';
      ctx.font = font(28, 600);
      ctx.fillText(String(naturalScore[dim]), x + w - 18, 1620);
    });

    // 底部
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(120, 1700);
    ctx.lineTo(W - 120, 1700);
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.fillStyle = '#1f2329';
    ctx.font = font(30, 600);
    ctx.fillText('三面 · persona.chesterlee.cn', W / 2, 1766);
    ctx.fillStyle = '#6b7280';
    ctx.font = font(24);
    ctx.fillText('结果只作自我认知与沟通参考，不构成心理诊断', W / 2, 1818);

    return canvas;
  }

  function shareFilename(entry) {
    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    return `work-persona-${entry.code}-${stamp}.png`;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function showSharePreview(blob, entry) {
    const mask = document.createElement('div');
    mask.className = 'wp-share-mask';
    mask.innerHTML = `
      <div class="wp-share-panel">
        <img class="wp-share-img" alt="分享图预览">
        <p class="wp-share-hint">长按图片可保存到相册；电脑端可点「下载图片」。</p>
        <div class="wp-share-actions">
          <button class="wp-btn wp-btn-primary" type="button" data-act="download">下载图片</button>
          <button class="wp-btn wp-btn-ghost" type="button" data-act="close">关闭</button>
        </div>
      </div>
    `;
    const url = URL.createObjectURL(blob);
    mask.querySelector('.wp-share-img').src = url;

    const close = () => {
      URL.revokeObjectURL(url);
      mask.remove();
    };

    mask.addEventListener('click', (event) => {
      if (event.target === mask) {
        close();
        return;
      }
      const btn = event.target.closest('button[data-act]');
      if (!btn) return;
      if (btn.getAttribute('data-act') === 'download') {
        downloadBlob(blob, shareFilename(entry));
      } else {
        close();
      }
    });

    document.body.appendChild(mask);
    log('分享图预览已生成', entry.code);
  }

  async function shareReport(entry) {
    let canvas = null;
    try {
      canvas = await buildShareCanvas(entry);
    } catch (err) {
      log('绘制分享图失败', err);
      window.alert('分享图生成失败，请重试。');
      return;
    }

    canvas.toBlob((blob) => {
      if (!blob) {
        log('分享图导出为空');
        window.alert('分享图生成失败，请重试。');
        return;
      }
      log('分享图已生成', entry.code, `${Math.round(blob.size / 1024)}KB`);
      showSharePreview(blob, entry);
    }, 'image/png');
  }

  // ── 历史列表 / 详情 ──────────────────────────────
  // 列表按时间倒序，本条的「上一条」就是数组里的下一位。
  function findPrevious(list, id) {
    const index = list.findIndex((item) => item.id === id);
    return index >= 0 ? list[index + 1] || null : null;
  }

  function describeShift(shift) {
    if (!shift) return '没有可比的位移';
    const dim = (CONTENT.DIMS[shift.dim] || {}).name || shift.dim;
    if (shift.delta === 0) return `${dim} 基本没变`;
    return `${dim} ${shift.dir === 'up' ? '上调' : '下调'} ${Math.abs(shift.delta)} 分`;
  }

  function compareCard(prev, current) {
    if (!prev) {
      return `
        <section class="wp-card wp-compare">
          <h3 class="wp-section-title">和上一次比</h3>
          <p class="wp-compare-empty">这是第一条记录，暂无对比。</p>
        </section>
      `;
    }

    const mainSame = prev.main === current.main;
    const codeSame = prev.code === current.code;
    return `
      <section class="wp-card wp-compare">
        <h3 class="wp-section-title">和上一次比</h3>
        <ul class="wp-compare-list">
          <li><strong>主维</strong><span>${mainSame ? '不变' : `由 ${prev.main} 变为 ${current.main}`}</span></li>
          <li><strong>类型代码</strong><span>${codeSame ? '不变' : `由 ${prev.code} 变为 ${current.code}`}</span></li>
          <li><strong>自然 → 工作</strong><span>${escapeHtml(describeShift(current.shifts.naturalWork))}</span></li>
          <li><strong>工作 → 压力</strong><span>${escapeHtml(describeShift(current.shifts.workStress))}</span></li>
        </ul>
        <p class="wp-compare-note">只和上一条（${formatDate(prev.createdAt)}）对比。</p>
      </section>
    `;
  }

  // 历史列表页脚注：跟着同步状态走，避免「只保存在本机」和自动同步打架。
  function cloudNote() {
    const api = syncApi();
    const info = api && api.state();
    if (info && info.enabled && info.lastSyncAt) return ' · 已同步到云端';
    return ' · 只保存在本机';
  }

  function renderHistory() {
    clearAuto();
    currentIndex = null;

    const list = loadHistory();
    const typeName = (code) => ((CONTENT.TYPE_NAMES || {})[code] || {}).name || code;

    view.innerHTML = `
      <section class="wp-history">
        <div class="wp-history-head">
          <button class="wp-link" id="wp-history-home" type="button">← 回到首页</button>
        </div>
        <h2 class="wp-history-title">历史记录</h2>
        <p class="wp-hint">共 ${list.length} 条${cloudNote()}</p>
        ${list.length ? `
          <ul class="wp-history-list">
            ${list.map((item, index) => {
              const prev = list[index + 1];
              const tag = !prev
                ? ''
                : `<span class="wp-history-tag">${prev.main === item.main ? '主维不变' : `主维 ${prev.main} → ${item.main}`}</span>`;
              return `
                <li>
                  <button class="wp-history-item" type="button" data-id="${escapeAttr(item.id)}">
                    <span class="wp-history-top">
                      <strong>${escapeHtml(item.code)} · ${escapeHtml(typeName(item.code))}</strong>
                      <time>${formatDate(item.createdAt)}</time>
                    </span>
                    <span class="wp-history-stages">
                      <span>自然 ${stageBrief(item.byStage.natural)}</span>
                      <span>工作 ${stageBrief(item.byStage.work)}</span>
                      <span>压力 ${stageBrief(item.byStage.stress)}</span>
                    </span>
                    ${tag}
                  </button>
                </li>
              `;
            }).join('')}
          </ul>
        ` : `
          <section class="wp-card">
            <p class="wp-profile">完成一次测评后，记录会出现在这里。</p>
            <button class="wp-btn wp-btn-primary" id="wp-history-start" type="button">去测评</button>
          </section>
        `}

        <div class="wp-data-entry">
          <button class="wp-link wp-link-exit" id="wp-history-data" type="button">数据与隐私</button>
        </div>
      </section>
    `;

    document.getElementById('wp-history-home').addEventListener('click', renderHome);
    document.getElementById('wp-history-data').addEventListener('click', renderData);

    const startBtn = document.getElementById('wp-history-start');
    if (startBtn) startBtn.addEventListener('click', startNew);

    const listEl = document.querySelector('.wp-history-list');
    if (listEl) {
      listEl.addEventListener('click', (event) => {
        const item = event.target.closest('button[data-id]');
        if (item) renderHistoryDetail(item.getAttribute('data-id'));
      });
    }

    log('打开历史列表', `${list.length} 条`);
  }

  // 详情按当时快照复看，不重新计分。
  function renderHistoryDetail(id) {
    const list = loadHistory();
    const entry = list.find((item) => item.id === id);
    if (!entry) {
      renderHistory();
      return;
    }
    log('查看历史详情', entry.id, entry.code);
    renderReport(entry, { fromHistory: true, previous: findPrevious(list, id) });
  }

  // ── 数据管理（导出 / 导入 / 清除 / 隐私）───────────
  function renderData() {
    clearAuto();
    currentIndex = null;

    const historyCount = loadHistory().length;
    const hasDraft = Boolean(readJSON(KEYS.draft, null));

    view.innerHTML = `
      <section class="wp-data">
        <div class="wp-history-head">
          <button class="wp-link" id="wp-data-home" type="button">← 回到首页</button>
        </div>
        <h2 class="wp-history-title">数据与隐私</h2>
        <p class="wp-hint">本机有 ${historyCount} 条历史${hasDraft ? ' · 1 份未完成草稿' : ''}</p>

        <section class="wp-card">
          <h3 class="wp-section-title">备份</h3>
          <p class="wp-profile">导出一个 JSON 文件，包含历史、草稿与昵称。换设备或清理浏览器前建议先备份。</p>
          <div class="wp-data-actions">
            <button class="wp-btn wp-btn-ghost" id="wp-export" type="button">导出备份</button>
            <button class="wp-btn wp-btn-ghost" id="wp-import" type="button">导入备份</button>
          </div>
          <input id="wp-import-file" type="file" accept=".json,application/json" hidden>
        </section>

        <section class="wp-card">
          <h3 class="wp-section-title">清除</h3>
          <p class="wp-profile">删除这台设备上的全部内容：历史、草稿、昵称，以及知识库里手动添加的来源。删除后不可恢复。</p>
          <button class="wp-btn wp-btn-danger" id="wp-clear" type="button">清除本机全部数据</button>
        </section>

        <section class="wp-card">
          <h3 class="wp-section-title">云端同步</h3>
          <p class="wp-profile" id="wp-sync-desc"></p>
          <div class="wp-data-actions" id="wp-sync-actions"></div>
        </section>

        <section class="wp-card">
          <h3 class="wp-section-title">隐私说明</h3>
          <ul class="wp-about-list">
            <li>未登录时，作答、报告与历史只保存在这台设备的浏览器里，不上传服务器。</li>
            <li>登录后会自动同步：历史 / 草稿 / 昵称按你的统一账户 uid 存到本站自己的同步服务；可在本页关闭同步或删除云端档案。</li>
            <li>换设备、换浏览器或清理浏览器数据后，本机记录会消失，重要结果请先导出备份。</li>
            <li>登录只用于显示昵称与同步，不会把测评内容写入账户中心。</li>
            <li>知识库里手动添加的来源也只存本机，可逐条删除。</li>
            <li>结果只作自我认知与沟通参考，不构成心理诊断或医疗建议。</li>
          </ul>
        </section>
      </section>
    `;

    document.getElementById('wp-data-home').addEventListener('click', renderHome);

    document.getElementById('wp-export').addEventListener('click', exportBackup);

    const fileInput = document.getElementById('wp-import-file');
    document.getElementById('wp-import').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const file = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (file) importBackup(file);
    });

    document.getElementById('wp-clear').addEventListener('click', clearAllData);

    if (syncCardOff) {
      syncCardOff();
      syncCardOff = null;
    }
    renderSyncCard();
    const syncModule = syncApi();
    if (syncModule && typeof syncModule.onChange === 'function') {
      syncCardOff = syncModule.onChange(renderSyncCard);
    }

    log('打开数据管理', `历史 ${historyCount} 条`, hasDraft ? '有草稿' : '无草稿');
  }

  // 云端同步卡片：未登录 / 未开启 / 已开启 三种状态
  function renderSyncCard() {
    const desc = document.getElementById('wp-sync-desc');
    const actions = document.getElementById('wp-sync-actions');
    if (!desc || !actions) return;

    const api = syncApi();
    if (!api) {
      desc.textContent = '同步模块没有加载，本地功能不受影响。';
      actions.innerHTML = '';
      return;
    }

    const info = api.state();
    if (!info.loggedIn) {
      desc.textContent = '登录后会自动把历史、草稿和昵称同步到自己的账户，换设备打开就能接着用。测评内容存在本站自己的同步服务里，不写入账户中心。';
      actions.innerHTML = '<button class="wp-btn wp-btn-ghost" id="wp-sync-login" type="button">登录</button>';
      document.getElementById('wp-sync-login').addEventListener('click', () => api.login());
      return;
    }

    if (!info.enabled) {
      desc.textContent = '你已关闭同步，本机数据照常使用。重新开启后，历史 / 草稿 / 昵称会按统一账户 uid 同步到本站服务，换设备可取回。';
      actions.innerHTML = '<button class="wp-btn" id="wp-sync-enable" type="button">开启同步</button>';
      document.getElementById('wp-sync-enable').addEventListener('click', () => {
        api.enable().catch(() => {});
      });
      return;
    }

    desc.textContent = syncStatusText(info);
    actions.innerHTML = `
      <button class="wp-btn wp-btn-ghost" id="wp-sync-now" type="button">立即同步</button>
      <button class="wp-btn wp-btn-ghost" id="wp-sync-off" type="button">关闭同步</button>
      <button class="wp-btn wp-btn-danger" id="wp-sync-del" type="button">删除云端档案</button>
    `;

    document.getElementById('wp-sync-now').addEventListener('click', () => {
      api.syncNow();
    });
    document.getElementById('wp-sync-off').addEventListener('click', () => {
      if (!window.confirm('关闭后这台设备不再自动同步，云端已有的档案会保留。确定关闭吗？')) return;
      api.disable();
    });
    document.getElementById('wp-sync-del').addEventListener('click', () => {
      if (!window.confirm('删除后云端档案不可恢复，其他设备也看不到这些记录。确定删除吗？')) return;
      api.removeCloud().then(() => {
        window.alert('云端档案已删除。');
        renderSyncCard();
      }).catch((err) => {
        log('删除云端档案失败', err && err.code, err && err.message);
        window.alert('删除失败，请稍后再试。');
      });
    });
  }

  function syncStatusText(info) {
    if (info.status === 'syncing') return '正在同步…';
    if (info.status === 'error') return `同步失败：${info.message || '网络异常'}（可点「立即同步」重试）`;
    if (info.status === 'pending') return '本地有改动，正在自动同步…';
    if (info.lastSyncAt) {
      const d = new Date(info.lastSyncAt);
      const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      return `已同步 · 最近一次 ${time}。历史 / 草稿 / 昵称已存在云端。`;
    }
    return '已登录，正在自动同步。';
  }

  function exportBackup() {
    const payload = {
      app: 'work-persona',
      schemaVersion: HISTORY_VERSION,
      exportedAt: new Date().toISOString(),
      settings: loadSettings(),
      draft: readJSON(KEYS.draft, null),
      history: loadHistory()
    };
    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;

    try {
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `work-persona-backup-${stamp}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      log('导出备份', `${payload.history.length} 条历史`);
    } catch (err) {
      log('导出备份失败', err);
      window.alert('导出失败，可以换用电脑浏览器再试一次。');
    }
  }

  // 冲突时以文件为准（先提示再覆盖）。
  function importBackup(file) {
    file.text().then((text) => {
      let data = null;
      try {
        data = JSON.parse(text);
      } catch (err) {
        log('备份 JSON 解析失败', err);
        window.alert('这个文件不是有效的备份 JSON。');
        return;
      }
      if (!data || typeof data !== 'object' || (!Array.isArray(data.history) && !data.settings && !data.draft)) {
        window.alert('备份文件里没有可恢复的数据。');
        return;
      }

      const nextHistory = Array.isArray(data.history) ? cleanHistory(data.history) : [];
      if (!window.confirm(`导入会用文件内容覆盖本机现有数据，确定吗？\n文件里有 ${nextHistory.length} 条历史。`)) {
        return;
      }

      if (Array.isArray(data.history)) writeJSON(KEYS.history, nextHistory);

      if (data.settings && typeof data.settings === 'object') {
        writeJSON(KEYS.settings, {
          nickname: String(data.settings.nickname || '').slice(0, 12),
          updatedAt: Date.now()
        });
      }

      if (data.draft && typeof data.draft === 'object'
        && data.draft.version === DRAFT_VERSION && typeof data.draft.answers === 'object') {
        writeJSON(KEYS.draft, data.draft);
      } else {
        removeKey(KEYS.draft);
      }
      draft = loadDraft();

      log('导入备份', `${nextHistory.length} 条历史`);
      syncTouch(true);
      window.alert(`导入完成，共 ${nextHistory.length} 条历史。`);
      renderData();
    }).catch((err) => {
      log('读取备份文件失败', err);
      window.alert('读取文件失败，请重试。');
    });
  }

  function clearAllData() {
    if (!window.confirm('将删除这台设备上的全部历史、草稿、昵称，以及知识库里手动添加的来源，且无法恢复。继续吗？')) return;
    if (!window.confirm('再确认一次：删除后不能撤销。需要保留请先导出备份。')) return;

    const api = syncApi();
    const info = api && typeof api.state === 'function' ? api.state() : null;
    const dropCloud = Boolean(info && info.enabled && info.loggedIn) &&
      window.confirm('云端还有一份同步档案：\n点「确定」= 本机和云端一起删除；\n点「取消」= 只清这台设备（下次打开会从云端同步回来）。');

    removeKey(KEYS.history);
    removeKey(KEYS.draft);
    removeKey(KEYS.settings);
    removeKey(KEYS.kbRefs);
    draft = null;

    if (dropCloud) {
      api.removeCloud().then(() => log('已删除云端档案')).catch((err) => {
        log('删除云端档案失败', err && err.code, err && err.message);
        window.alert('本机数据已清除，但云端档案删除失败；可在「数据与隐私」里再试一次。');
      });
    }

    log('已清除本机数据');
    renderHome();
  }

  // ── 关于 ─────────────────────────────────────────
  function renderAbout() {
    clearAuto();
    currentIndex = null;

    const app = CONTENT.APP || {};
    view.innerHTML = `
      <section class="wp-about">
        <div class="wp-history-head">
          <button class="wp-link" id="wp-about-home" type="button">← 回到首页</button>
        </div>
        <h2 class="wp-history-title">关于${escapeHtml(app.name || '三面')}</h2>
        <p class="wp-hint">${escapeHtml(app.version || '')} · 更新于 ${escapeHtml(app.updatedAt || '')}</p>

        <section class="wp-card">
          <h3 class="wp-section-title">这是什么</h3>
          <p class="wp-profile">${escapeHtml(app.intro || '')}</p>
          <p class="wp-profile">${escapeHtml(app.positioning || '')}</p>
        </section>

        <section class="wp-card">
          <h3 class="wp-section-title">怎么用</h3>
          <ul class="wp-about-list">
            ${(app.howto || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
          </ul>
        </section>

        <section class="wp-card">
          <h3 class="wp-section-title">数据与账号</h3>
          <ul class="wp-about-list">
            ${(app.account || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
          </ul>
          <button class="wp-btn wp-btn-ghost wp-btn-block" id="wp-about-data" type="button">打开数据与隐私</button>
        </section>

        <section class="wp-card wp-disclaimer">
          <h3 class="wp-section-title">边界</h3>
          <ul class="wp-about-list">
            ${(CONTENT.DISCLAIMER || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
          </ul>
        </section>

        <p class="wp-about-foot">${escapeHtml(app.name || '三面')} · ${escapeHtml(app.tagline || '')} · persona.chesterlee.cn</p>
      </section>
    `;

    document.getElementById('wp-about-home').addEventListener('click', renderHome);
    document.getElementById('wp-about-data').addEventListener('click', renderData);
    log('打开关于页', app.version);
  }

  function buildFeatures(entry, type) {
    const mainTraits = ((CONTENT.TRAITS || {})[entry.main] || {}).main || [];
    const secondaryTraits = (((CONTENT.TRAITS || {})[entry.secondary] || {}).main || []).slice(0, 2);
    const lowTraits = entry.low !== entry.main && entry.low !== entry.secondary
      ? (((CONTENT.TRAITS || {})[entry.low] || {}).low || []).slice(0, 2)
      : [];

    const features = mainTraits.concat(secondaryTraits, lowTraits);
    features.push(shiftFeature('naturalWork', entry.shifts.naturalWork));
    features.push(shiftFeature('workStress', entry.shifts.workStress));
    if (type.line) {
      features.push(`你的类型组合是「${type.name}」：${type.line}。`);
    }
    if (type.cost) {
      features.push(`这套风格要留意的代价：${type.cost}`);
    }

    return features.filter((item, index, list) => list.indexOf(item) === index).slice(0, 12);
  }

  function shiftFeature(transition, shift) {
    const dim = CONTENT.DIMS[shift.dim].name;
    const isNaturalWork = transition === 'naturalWork';

    if (shift.delta === 0) {
      return `${isNaturalWork ? '自然到工作' : '工作到压力'}，你的${dim}几乎没有位移。`;
    }
    if (isNaturalWork) {
      return shift.dir === 'up'
        ? `进入工作后，你的${dim}明显往上走（${shift.from} → ${shift.to}）。`
        : `进入工作后，你的${dim}收了一截（${shift.from} → ${shift.to}）。`;
    }
    return shift.dir === 'up'
      ? `压力下，你的${dim}被放大（${shift.from} → ${shift.to}）。`
      : `压力下，你的${dim}反而退了（${shift.from} → ${shift.to}）。`;
  }

  function buildStateProfile(stage, main, secondary) {
    const texts = CONTENT.STATE_TEXT[stage];
    const bridge = `这两股力量一起出现时，${CONTENT.DIMS[main].name}负责${CONTENT.FUNCTION[main]}，${CONTENT.DIMS[secondary].name}负责${CONTENT.FUNCTION[secondary]}。`;
    return `${CONTENT.STATE_LEAD[stage]}${texts[main]}同时，${texts[secondary]}${bridge}${CONTENT.STATE_EXTRA[stage]}${CONTENT.STATE_CLOSING[stage]}`;
  }

  function buildShiftReading(transition, shift) {
    const dim = CONTENT.DIMS[shift.dim].name;
    const range = `${shift.from} → ${shift.to}`;

    if (shift.delta === 0) {
      return `两个状态之间，${dim}几乎没有位移（${range}），你在这两处的打法相当接近。`;
    }

    const behavior = CONTENT.SHIFT_BEHAVIOR[transition][shift.dim][shift.dir];
    if (transition === 'naturalWork') {
      return shift.dir === 'up'
        ? `自然到工作，位移最大的是${dim}（${range}）。${behavior}——这更像是你为了把事做成而戴上的面具。`
        : `自然到工作，收敛最多的是${dim}（${range}）。${behavior}——你把力气挪到了别处。`;
    }
    return shift.dir === 'up'
      ? `工作到压力，放大最多的是${dim}（${range}）。${behavior}——这是你紧绷时最容易调用的反应。`
      : `工作到压力，退得最多的是${dim}（${range}）。${behavior}——你先顾眼前，把它放到了一边。`;
  }

  // ── 工具 ─────────────────────────────────────────
  function formatDate(iso) {
    const date = new Date(iso);
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[ch]));
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }

  // ── 启动 ─────────────────────────────────────────
  function init() {
    if (!view) return;
    if (!QUESTIONS.length) {
      view.innerHTML = '<section class="wp-card"><p>题库没有加载，请刷新页面重试。</p></section>';
      return;
    }
    draft = loadDraft();
    log('题库', QUESTIONS.length, '题', '｜草稿', draft ? '有' : '无');

    // 云端合并回来的草稿 / 设置 / 历史：刷新内存态；停在首页时重绘一次
    document.addEventListener('wp:sync-merged', () => {
      draft = loadDraft();
      if (currentIndex === null && document.getElementById('wp-start')) renderHome();
    });

    renderHome();
  }

  init();
})();
