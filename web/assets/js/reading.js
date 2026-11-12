// 阅读人格页面：粘贴导入 / 手填四组 → 四位代码 → 结果卡，纯前端 + localStorage。
// 数据来自微信读书插件（阅读洞察），本站不算分，只负责录入、展示与同步。
(() => {
  'use strict';

  const CONTENT = window.WP_READING_CONTENT || { dims: [], types: {}, note: '' };
  const KEY = 'wp_reading_result';
  const LETTERS = 'DBFMLEPR';

  const view = document.getElementById('reading-view');
  const log = (...args) => console.log('[wp] reading', ...args);

  let result = loadResult();
  let tab = 'paste';
  let manual = {};
  let pasteError = '';

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

  function validCode(code) {
    return new RegExp('^[' + LETTERS + ']{4}$').test(String(code || ''));
  }

  function loadResult() {
    const raw = readJSON(KEY, null);
    return raw && validCode(raw.code) && raw.dims ? raw : null;
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

  function formatDate(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function typeInfo(code) {
    const info = CONTENT.types[code] || {};
    return { name: info.name || '这一型', line: info.line || '' };
  }

  function wordOf(dim, letter) {
    return letter === dim.right ? dim.rightWord : dim.leftWord;
  }

  function letterOf(dim, percent) {
    return percent >= 50 ? dim.left : dim.right;
  }

  // ── 解析粘贴内容 ─────────────────────────
  // 兼容两种粘法：① JSON（含 code 字段）② 任意文本里带四位代码，如「DFLP」
  // 百分比是可选的：认出「深潜 78%」这类写法就用，认不出只存字母。
  function percentFromText(text, word) {
    const match = text.match(new RegExp(word + '\\s*[:：]?\\s*(\\d{1,3})\\s*%'));
    if (!match) return null;
    const value = Number(match[1]);
    return value >= 0 && value <= 100 ? value : null;
  }

  function parsePaste(text) {
    const raw = String(text || '').trim();
    if (!raw) return { ok: false, error: '先把插件里的结果粘进来。' };

    let code = '';
    if (raw.charAt(0) === '{') {
      try {
        const data = JSON.parse(raw);
        code = String((data && (data.code || data.type)) || '');
      } catch (err) {
        code = '';
      }
    }
    if (!code) {
      const match = raw.match(/(^|[^A-Za-z])([DBFMLEPR]{4})(?![A-Za-z])/);
      if (match) code = match[2];
    }
    code = code.trim().toUpperCase();
    if (!validCode(code)) return { ok: false, error: '没找到四位代码，形如 DFLP。' };

    const dims = {};
    for (let i = 0; i < CONTENT.dims.length; i += 1) {
      const dim = CONTENT.dims[i];
      const letter = code.charAt(i);
      if (letter !== dim.left && letter !== dim.right) {
        return { ok: false, error: `第 ${i + 1} 位应该是 ${dim.left} 或 ${dim.right}（${dim.name}）。` };
      }
      let percent = percentFromText(raw, dim.leftWord);
      if (percent == null) {
        const rightPercent = percentFromText(raw, dim.rightWord);
        if (rightPercent != null) percent = 100 - rightPercent;
      }
      dims[dim.key] = { letter, percent };
    }
    return { ok: true, code, dims };
  }

  // ── 保存 ─────────────────────────────────
  function saveEntry(data) {
    const now = new Date().toISOString();
    const entry = {
      code: data.code,
      dims: data.dims,
      source: data.source,
      createdAt: now,
      updatedAt: now
    };
    if (!writeJSON(KEY, entry)) {
      pasteError = '本地写入失败，请检查浏览器存储是否已满。';
      renderForm();
      return;
    }
    result = entry;
    pasteError = '';
    syncTouch(true);
    log('结果', entry.code, entry.source);
    renderResult();
  }

  // ── 录入页 ───────────────────────────────
  function renderForm() {
    CONTENT.dims.forEach((dim) => {
      if (manual[dim.key] == null) manual[dim.key] = 50;
    });

    const rows = CONTENT.dims.map((dim) => {
      const value = manual[dim.key];
      return `
        <div class="wp-read-row">
          <div class="wp-read-head">
            <span class="wp-read-name">${escapeHtml(dim.name)}</span>
            <span class="wp-read-val" id="read-val-${dim.key}">${escapeHtml(dim.leftWord)} ${value}% · ${escapeHtml(dim.rightWord)} ${100 - value}%</span>
          </div>
          <input class="wp-read-slider" type="range" min="0" max="100" step="1" value="${value}"
                 data-dim="${dim.key}" aria-label="${escapeHtml(dim.name)}：${escapeHtml(dim.leftWord)}到${escapeHtml(dim.rightWord)}">
          <div class="wp-read-pair">
            <span>${escapeHtml(dim.leftWord)}（${dim.left}）</span>
            <span>${escapeHtml(dim.rightWord)}（${dim.right}）</span>
          </div>
        </div>
      `;
    }).join('');

    view.innerHTML = `
      <section class="wp-card">
        <p class="wp-eyebrow">阅读人格 · 录入</p>
        <h2 class="wp-hero-title">录一份阅读人格</h2>
        <p class="wp-hero-text">${escapeHtml(CONTENT.intro || '')}</p>

        <div class="wp-read-tabs" role="tablist">
          <button class="wp-read-tab ${tab === 'paste' ? 'is-active' : ''}" data-tab="paste" type="button" role="tab" aria-selected="${tab === 'paste'}">粘贴导入</button>
          <button class="wp-read-tab ${tab === 'manual' ? 'is-active' : ''}" data-tab="manual" type="button" role="tab" aria-selected="${tab === 'manual'}">手填四组</button>
        </div>

        ${tab === 'paste' ? `
          <div class="wp-read-panel">
            <p class="wp-hint">把插件「阅读洞察」里的结果整段粘进来，能认出四位代码（如 DFLP）；带「深潜 78%」这类百分比时会一起存下。</p>
            <textarea class="wp-read-textarea" id="read-paste" rows="5" placeholder="例如：&#10;我的阅读人格：DFLP&#10;深潜 78% · 广撒 22%"></textarea>
            <p class="wp-read-error" id="read-error" ${pasteError ? '' : 'hidden'}>${escapeHtml(pasteError)}</p>
            <button class="wp-btn wp-btn-primary wp-btn-block" id="read-parse" type="button">解析并保存</button>
          </div>
        ` : `
          <div class="wp-read-panel">
            <p class="wp-hint">把每条滑到自己更像的位置：越靠左越接近左边那极，中间就是差不多。</p>
            ${rows}
            <button class="wp-btn wp-btn-primary wp-btn-block" id="read-save" type="button">保存这四组</button>
          </div>
        `}

        <ul class="wp-oe-notes">
          <li>阅读人格不是做题算出来的，它来自你的真实阅读记录；这里只做录入，不采集微信读书数据。</li>
          <li>${escapeHtml(CONTENT.note || '')}</li>
        </ul>
      </section>
    `;

    document.querySelectorAll('.wp-read-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        tab = btn.dataset.tab;
        pasteError = '';
        renderForm();
      });
    });

    const parseBtn = document.getElementById('read-parse');
    if (parseBtn) {
      parseBtn.addEventListener('click', () => {
        const parsed = parsePaste(document.getElementById('read-paste').value);
        if (!parsed.ok) {
          pasteError = parsed.error;
          renderForm();
          return;
        }
        saveEntry({ code: parsed.code, dims: parsed.dims, source: 'paste' });
      });
    }

    const saveBtn = document.getElementById('read-save');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        const dims = {};
        let code = '';
        CONTENT.dims.forEach((dim) => {
          const percent = manual[dim.key];
          const letter = letterOf(dim, percent);
          dims[dim.key] = { letter, percent };
          code += letter;
        });
        saveEntry({ code, dims, source: 'manual' });
      });
    }

    view.querySelectorAll('.wp-read-slider').forEach((slider) => {
      slider.addEventListener('input', () => {
        const dim = CONTENT.dims.find((item) => item.key === slider.dataset.dim);
        if (!dim) return;
        const value = Number(slider.value);
        manual[dim.key] = value;
        const label = document.getElementById('read-val-' + dim.key);
        if (label) {
          label.textContent = `${dim.leftWord} ${value}% · ${dim.rightWord} ${100 - value}%`;
        }
      });
    });
  }

  // ── 结果页 ───────────────────────────────
  function renderResult() {
    if (!result) {
      renderForm();
      return;
    }

    const info = typeInfo(result.code);
    const dims = result.dims || {};
    const sourceText = result.source === 'manual' ? '手填四组' : '粘贴导入';

    const rows = CONTENT.dims.map((dim) => {
      const data = dims[dim.key] || {};
      const letter = data.letter === dim.right ? dim.right : dim.left;
      const percent = typeof data.percent === 'number' ? data.percent : null;
      const text = letter === dim.right ? dim.rightText : dim.leftText;
      const pick = percent == null ? wordOf(dim, letter) : `${wordOf(dim, letter)} · ${percent}%`;
      return `
        <div class="wp-oe-meter">
          <div class="wp-oe-meter-head">
            <span class="wp-oe-meter-name">${escapeHtml(dim.name)}</span>
            <span class="wp-oe-meter-pick">${escapeHtml(pick)}</span>
          </div>
          <div class="wp-oe-bar" aria-hidden="true">
            <i style="width:${percent == null ? 50 : percent}%"></i>
          </div>
          <div class="wp-oe-meter-end">
            <span>${escapeHtml(dim.leftWord)}（${dim.left}）</span>
            <span>${escapeHtml(dim.rightWord)}（${dim.right}）</span>
          </div>
          <p class="wp-oe-meter-text">${escapeHtml(text || '')}</p>
        </div>
      `;
    }).join('');

    view.innerHTML = `
      <section class="wp-card wp-oe-result">
        <p class="wp-eyebrow">你的阅读人格 · ${formatDate(result.createdAt)}</p>
        <div class="wp-oe-code">${escapeHtml(result.code)}</div>
        <h2 class="wp-oe-type-name">${escapeHtml(info.name)}</h2>
        <p class="wp-oe-summary">${escapeHtml(info.line)}</p>
        <p class="wp-hint">来源：${sourceText}</p>
      </section>

      <section class="wp-card">
        <h3 class="wp-section-title">四个维度怎么看</h3>
        ${rows}
      </section>

      <section class="wp-card">
        <h3 class="wp-section-title">这份结果怎么用</h3>
        <ul class="wp-oe-notes">
          <li>它说的是「你平时怎么读」，不是「你读得好不好」，也没有哪一型更高级。</li>
          <li>${escapeHtml(CONTENT.note || '')}</li>
        </ul>
        <div class="wp-oe-actions">
          <button class="wp-btn wp-btn-primary wp-btn-block" id="read-edit" type="button">重新录入</button>
          <a class="wp-btn wp-btn-ghost wp-btn-block" href="./profile.html">看人格档案</a>
        </div>
      </section>
    `;

    document.getElementById('read-edit').addEventListener('click', () => {
      // 回到录入页时沿用上次的方式，并把百分比带回去，方便微调
      manual = {};
      CONTENT.dims.forEach((dim) => {
        const data = (result.dims || {})[dim.key];
        if (data && typeof data.percent === 'number') manual[dim.key] = data.percent;
      });
      pasteError = '';
      tab = result.source === 'manual' ? 'manual' : 'paste';
      renderForm();
    });

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ── 启动 ─────────────────────────────────
  function init() {
    if (!view) return;
    if (!CONTENT.dims.length) {
      view.innerHTML = '<section class="wp-card"><p>内容模块没有加载，请刷新页面重试。</p></section>';
      return;
    }
    log(result ? `已有结果 ${result.code}` : '暂无结果');

    document.addEventListener('wp:sync-merged', () => {
      const next = loadResult();
      if (!next && !result) return;
      result = next;
      if (result) renderResult();
      else renderForm();
    });

    if (result) renderResult();
    else renderForm();
  }

  init();
})();
