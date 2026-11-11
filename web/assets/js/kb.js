// 站内知识库：中文来源条目 + 本机手动添加，所有内容都在站内打开，不生成外站跳转。
(() => {
  'use strict';

  const CONTENT = window.WP_CONTENT || {};
  const SEED = Array.isArray(CONTENT.REF_LIBRARY) ? CONTENT.REF_LIBRARY : [];
  const STORE_KEY = 'wp_kb_refs';
  const MAX_USER = 100;

  const listEl = document.getElementById('wp-kb-list');
  const noteEl = document.getElementById('wp-kb-note');
  const formEl = document.getElementById('wp-kb-form');
  const addBtn = document.getElementById('wp-kb-add');
  const errorEl = document.getElementById('wp-kb-error');
  const titleEl = document.getElementById('wp-kb-title');
  const typeEl = document.getElementById('wp-kb-type');
  const metaEl = document.getElementById('wp-kb-meta');
  const bodyEl = document.getElementById('wp-kb-body');

  const log = (...args) => console.log('[wp-kb]', ...args);

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[ch]));
  }

  // ── 本机条目 ─────────────────────────────────────
  function loadUserRefs() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      const data = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(data)) return [];
      return data.filter((item) => item && item.id && item.title && item.body);
    } catch (err) {
      log('读取本机来源失败', err);
      return [];
    }
  }

  function saveUserRefs(list) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(list));
      return true;
    } catch (err) {
      log('写入本机来源失败', err);
      return false;
    }
  }

  function allEntries() {
    const seed = SEED.map((item) => Object.assign({}, item, { mine: false }));
    const mine = loadUserRefs().map((item) => Object.assign({}, item, { mine: true }));
    return seed.concat(mine);
  }

  // ── 渲染 ─────────────────────────────────────────
  function paragraphsOf(item) {
    const raw = Array.isArray(item.body) ? item.body : String(item.body || '').split(/\n+/);
    return raw.map((text) => String(text).trim()).filter(Boolean);
  }

  function entryHtml(item) {
    const paras = paragraphsOf(item).map((text) => `<p>${escapeHtml(text)}</p>`).join('');
    const summary = item.summary || paragraphsOf(item)[0] || '';
    return `
      <article class="wp-card wp-kb-item" id="kb-${escapeHtml(item.id)}">
        <div class="wp-kb-item-head">
          <span class="wp-kb-type">${escapeHtml(item.type || '资料')}</span>
          <h2 class="wp-kb-item-title">${escapeHtml(item.title)}</h2>
        </div>
        ${item.meta ? `<p class="wp-kb-item-meta">${escapeHtml(item.meta)}</p>` : ''}
        <p class="wp-kb-item-summary">${escapeHtml(summary)}</p>
        <div class="wp-kb-detail" hidden>
          ${paras}
          ${item.note ? `<p class="wp-kb-item-note">${escapeHtml(item.note)}</p>` : ''}
        </div>
        <div class="wp-kb-item-foot">
          <button class="wp-kb-toggle" type="button" data-toggle aria-expanded="false">展开全文</button>
          ${item.mine ? '<span class="wp-kb-badge">本机添加</span>' : ''}
          ${item.mine ? `<button class="wp-link wp-kb-del" type="button" data-del="${escapeHtml(item.id)}">删除</button>` : ''}
        </div>
      </article>
    `;
  }

  function bindItemActions() {
    listEl.querySelectorAll('[data-toggle]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const detail = btn.closest('.wp-kb-item').querySelector('.wp-kb-detail');
        if (!detail) return;
        const open = detail.hidden;
        detail.hidden = !open;
        btn.textContent = open ? '收起' : '展开全文';
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    });

    listEl.querySelectorAll('[data-del]').forEach((btn) => {
      btn.addEventListener('click', () => removeEntry(btn.getAttribute('data-del')));
    });
  }

  function render(openId) {
    const entries = allEntries();
    listEl.innerHTML = entries.length
      ? entries.map(entryHtml).join('')
      : '<section class="wp-card"><p class="wp-profile">还没有条目。</p></section>';
    bindItemActions();
    noteEl.textContent = CONTENT.KB_NOTE || '';

    if (openId) {
      const target = document.getElementById(`kb-${openId}`);
      const detail = target && target.querySelector('.wp-kb-detail');
      const toggle = target && target.querySelector('[data-toggle]');
      if (detail) detail.hidden = false;
      if (toggle) {
        toggle.textContent = '收起';
        toggle.setAttribute('aria-expanded', 'true');
      }
      if (target) {
        target.classList.add('is-target');
        target.scrollIntoView({ block: 'start' });
      }
    }

    log('渲染条目', entries.length, '条');
  }

  function openFromQuery() {
    const ref = new URLSearchParams(window.location.search).get('ref');
    if (ref) render(ref);
    else render();
  }

  // ── 加入 / 删除 ──────────────────────────────────
  function showError(message) {
    errorEl.textContent = message;
    errorEl.hidden = false;
  }

  function clearError() {
    errorEl.textContent = '';
    errorEl.hidden = true;
  }

  addBtn.addEventListener('click', () => {
    formEl.hidden = !formEl.hidden;
    addBtn.textContent = formEl.hidden ? '＋ 加入参考来源' : '收起表单';
    clearError();
    if (!formEl.hidden) titleEl.focus();
  });

  document.getElementById('wp-kb-cancel').addEventListener('click', () => {
    formEl.hidden = true;
    addBtn.textContent = '＋ 加入参考来源';
    clearError();
  });

  formEl.addEventListener('submit', (event) => {
    event.preventDefault();
    const title = titleEl.value.trim();
    const body = bodyEl.value.trim();
    if (!title) {
      showError('先填标题。');
      titleEl.focus();
      return;
    }
    if (!body) {
      showError('再写一句说明。');
      bodyEl.focus();
      return;
    }

    const list = loadUserRefs();
    if (list.length >= MAX_USER) {
      showError(`本机最多存 ${MAX_USER} 条，先删几条再添加。`);
      return;
    }

    const entry = {
      id: 'usr_' + Date.now(),
      type: typeEl.value,
      title: title,
      meta: metaEl.value.trim(),
      summary: body.replace(/\s+/g, ' ').slice(0, 48),
      body: body.split(/\n+/).map((text) => text.trim()).filter(Boolean),
      createdAt: new Date().toISOString()
    };

    if (!saveUserRefs([entry].concat(list))) {
      showError('写入本机失败，可能是隐私模式或存储已满。');
      return;
    }

    log('加入来源', entry.title);
    formEl.reset();
    formEl.hidden = true;
    addBtn.textContent = '＋ 加入参考来源';
    clearError();
    render(entry.id);
  });

  function removeEntry(id) {
    if (!window.confirm('删除这条本机添加的来源？')) return;
    const next = loadUserRefs().filter((item) => item.id !== id);
    if (!saveUserRefs(next)) {
      log('删除来源失败', id);
      return;
    }
    log('删除来源', id);
    render();
  }

  openFromQuery();
})();
