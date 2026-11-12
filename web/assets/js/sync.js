// 云端同步（P1）：登录后把「历史 / 草稿 / 设置」按 uid 存到自己的同步服务。
// 不碰账户中心业务数据；未登录或服务不可用时，本地答题与报告完全不受影响。
// 依赖：account.js 暴露的 window.WPAccount（同一套账户地址与 SDK）。
(() => {
  'use strict';

  const KEYS = {
    draft: 'wp_draft',
    history: 'wp_history',
    settings: 'wp_settings',
    meta: 'wp_sync_meta',
    oejtsDraft: 'wp_oejts_draft',
    oejtsResult: 'wp_oejts_result',
    readingResult: 'wp_reading_result'
  };
  const MAX_BYTES = 240 * 1024;
  const HISTORY_LIMIT = 50;
  const DRAFT_PUSH_INTERVAL = 60 * 1000; // 答题中草稿最多 60 秒推一次
  const MIN_GAP = 5000; // 任意两次同步至少隔 5 秒

  const log = (...args) => console.log('[wp] sync', ...args);
  const isLocal = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);

  // 线上与页面同源（Caddy 反代 /wp-sync/*）；本机直连同步服务端口。
  const base = () => String(window.WP_SYNC_BASE || (isLocal ? 'http://127.0.0.1:8944' : '')).replace(/\/+$/, '');

  let sdk = null;
  let user = null;
  let meta = loadMeta();
  let status = 'off'; // off | synced | pending | syncing | error
  let message = '';
  let lastRunAt = 0;
  let busy = false;
  let queued = false;
  let retries = 0;
  let retryTimer = null;
  let draftTimer = null;
  const listeners = new Set();

  // ── 本地读写（与 app.js 用同一批键，写回时保持结构一致）──
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

  function loadMeta() {
    const raw = readJSON(KEYS.meta, null);
    return {
      enabled: Boolean(raw && raw.enabled),
      disabledByUser: Boolean(raw && raw.disabledByUser),
      version: Number(raw && raw.version) || 0,
      lastSyncAt: Number(raw && raw.lastSyncAt) || 0,
      pending: Boolean(raw && raw.pending)
    };
  }

  function saveMeta() {
    writeJSON(KEYS.meta, meta);
  }

  function token() {
    try {
      return localStorage.getItem('ps_token') || '';
    } catch (err) {
      return '';
    }
  }

  function localProfile() {
    const settings = readJSON(KEYS.settings, { nickname: '' }) || { nickname: '' };
    const draft = readJSON(KEYS.draft, null);
    return {
      settings: { nickname: String(settings.nickname || ''), updatedAt: Number(settings.updatedAt) || 0 },
      draft: draft && draft.answers ? draft : null,
      history: Array.isArray(readJSON(KEYS.history, [])) ? readJSON(KEYS.history, []) : [],
      oejtsDraft: readJSON(KEYS.oejtsDraft, null),
      oejtsResult: readJSON(KEYS.oejtsResult, null),
      readingResult: readJSON(KEYS.readingResult, null),
      updatedAt: 0
    };
  }

  // 时间戳：主测评用数字 updatedAt，历史与 16 型结果用 ISO 字符串 createdAt。
  const stamp = (item) => {
    if (!item) return 0;
    const value = item.updatedAt || item.createdAt;
    const time = typeof value === 'string' ? Date.parse(value) : Number(value);
    return Number.isFinite(time) ? time : 0;
  };

  function pickNewer(a, b) {
    if (!a) return b;
    if (!b) return a;
    return stamp(b) > stamp(a) ? b : a; // 一样新时保留云端
  }

  // 合并规则：设置 / 草稿取较新；历史按 id 去重取并集，同 id 取较新。
  function mergeProfile(local, remote) {
    const l = local || {};
    const r = remote || {};
    const settings = pickNewer(
      { nickname: String((l.settings && l.settings.nickname) || ''), updatedAt: Number(l.settings && l.settings.updatedAt) || 0 },
      { nickname: String((r.settings && r.settings.nickname) || ''), updatedAt: Number(r.settings && r.settings.updatedAt) || 0 }
    );
    const draft = pickNewer(l.draft || null, r.draft || null);

    const map = new Map();
    [r.history || [], l.history || []].forEach((list) => {
      list.forEach((item) => {
        if (!item || !item.id || !item.createdAt) return;
        const prev = map.get(item.id);
        if (!prev || stamp(item) > stamp(prev)) map.set(item.id, item);
      });
    });
    const history = Array.from(map.values())
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, HISTORY_LIMIT);

    return {
      settings,
      draft,
      history,
      oejtsDraft: pickNewer(l.oejtsDraft || null, r.oejtsDraft || null),
      oejtsResult: pickNewer(l.oejtsResult || null, r.oejtsResult || null),
      readingResult: pickNewer(l.readingResult || null, r.readingResult || null),
      updatedAt: Math.max(Number(l.updatedAt) || 0, Number(r.updatedAt) || 0)
    };
  }

  function sameProfile(a, b) {
    return profileKey(a) === profileKey(b);
  }

  // 只比「会被合并的字段」；历史用 id + 时间戳代表内容是否变化。
  function profileKey(profile) {
    const p = profile || {};
    return JSON.stringify([
      String((p.settings && p.settings.nickname) || ''),
      Number(p.settings && p.settings.updatedAt) || 0,
      p.draft || null,
      ((p.history || []).map((item) => `${item.id}:${stamp(item)}`)),
      p.oejtsDraft || null,
      p.oejtsResult || null,
      p.readingResult || null
    ]);
  }

  function applyLocal(profile) {
    writeJSON(KEYS.settings, profile.settings);
    if (profile.draft) writeJSON(KEYS.draft, profile.draft);
    writeJSON(KEYS.history, profile.history);
    if (profile.oejtsDraft) writeJSON(KEYS.oejtsDraft, profile.oejtsDraft);
    if (profile.oejtsResult) writeJSON(KEYS.oejtsResult, profile.oejtsResult);
    if (profile.readingResult) writeJSON(KEYS.readingResult, profile.readingResult);
  }

  // ── 状态与 UI ──
  function emit() {
    listeners.forEach((fn) => {
      try {
        fn(state());
      } catch (err) {
        log('监听器异常', err);
      }
    });
    renderLine();
  }

  function state() {
    return {
      enabled: meta.enabled,
      status,
      message,
      lastSyncAt: meta.lastSyncAt,
      loggedIn: Boolean(user),
      version: meta.version
    };
  }

  function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function timeText(at) {
    const d = new Date(at);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function statusText(info) {
    if (!info.enabled || !info.loggedIn) return '';
    if (info.status === 'syncing') return '同步中…';
    if (info.status === 'error') return `同步失败，点此重试`;
    if (info.status === 'pending') return '本地有改动，正在自动同步';
    if (info.status === 'synced' && info.lastSyncAt) return `已同步 · ${timeText(info.lastSyncAt)}`;
    return '自动同步中';
  }

  function renderLine() {
    const host = document.querySelector('.wp-brand');
    if (!host) return;
    let el = document.getElementById('wpSyncLine');
    if (!el) {
      el = document.createElement('p');
      el.id = 'wpSyncLine';
      el.className = 'wp-sync-line';
      el.hidden = true;
      host.insertAdjacentElement('afterend', el);
      el.addEventListener('click', () => {
        if (!user) {
          login();
          return;
        }
        syncNow();
      });
    }
    const text = statusText(state());
    el.textContent = text;
    el.hidden = !text;
  }

  // ── 网络 ──
  function request(method, suffix, body) {
    const tk = token();
    if (!tk) return Promise.reject(Object.assign(new Error('未登录'), { code: 'NO_TOKEN' }));
    const headers = { Authorization: `Bearer ${tk}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    return fetch(`${base()}/wp-sync/${suffix}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    }).then((res) => res.json().catch(() => null).then((data) => {
      if (!data) throw Object.assign(new Error('返回格式不对'), { code: 'BAD_RESPONSE', status: res.status });
      if (res.ok && data.ok) return data.data;
      throw Object.assign(new Error(data.message || '同步失败'), {
        code: data.code || 'FAILED',
        status: res.status,
        data: data.data
      });
    }));
  }

  function limitPayload(profile) {
    const size = (obj) => new TextEncoder().encode(JSON.stringify(obj)).length;
    let next = profile;
    while (size(next) > MAX_BYTES && next.history.length) {
      next = { ...next, history: next.history.slice(0, Math.max(0, next.history.length - 10)) };
    }
    if (size(next) > MAX_BYTES && next.draft) {
      next = { ...next, draft: null };
    }
    if (size(next) > MAX_BYTES && next.oejtsDraft) {
      next = { ...next, oejtsDraft: null };
    }
    if (size(next) > MAX_BYTES && next.oejtsResult) {
      next = { ...next, oejtsResult: null };
    }
    if (size(next) > MAX_BYTES && next.readingResult) {
      next = { ...next, readingResult: null };
    }
    return next;
  }

  // 拉取 → 合并 → 按需推送；409 时用云端最新版本再合并一次。
  async function runSync() {
    if (!meta.enabled) return;
    if (!token()) {
      status = 'error';
      message = '登录已失效，请重新登录';
      emit();
      return;
    }

    status = 'syncing';
    message = '';
    emit();

    const remoteData = await request('GET', 'load');
    const remote = remoteData && remoteData.profile ? remoteData.profile : null;
    let merged = mergeProfile(localProfile(), remote);
    const localBefore = localProfile();

    if (!sameProfile(merged, localBefore)) {
      applyLocal(merged);
      document.dispatchEvent(new CustomEvent('wp:sync-merged', { detail: { profile: merged } }));
    }

    let version = Number(remoteData && remoteData.version) || 0;
    const needPush = !remote || !sameProfile(merged, remote);
    if (needPush) {
      let bodyProfile = limitPayload({ ...merged, updatedAt: Date.now() });
      try {
        const saved = await request('POST', 'save', { baseVersion: version, profile: bodyProfile });
        version = Number(saved.version) || version + 1;
      } catch (err) {
        if (err.code !== 'CONFLICT') throw err;
        // 云端在中间被别的设备写过：用返回的档案再合并一次，重试一次就够
        const again = mergeProfile(bodyProfile, err.data && err.data.profile);
        applyLocal(again);
        document.dispatchEvent(new CustomEvent('wp:sync-merged', { detail: { profile: again } }));
        const saved = await request('POST', 'save', {
          baseVersion: Number(err.data && err.data.version) || 0,
          profile: limitPayload({ ...again, updatedAt: Date.now() })
        });
        version = Number(saved.version) || version + 1;
      }
    }

    meta.version = version;
    meta.lastSyncAt = Date.now();
    meta.pending = false;
    saveMeta();
    retries = 0;
    status = 'synced';
    message = '';
    log('已同步', `v${version}`, `历史 ${merged.history.length} 条`);
    emit();
  }

  function syncNow() {
    if (!meta.enabled) return Promise.resolve(false);
    if (busy) {
      queued = true;
      return Promise.resolve(false);
    }
    const wait = MIN_GAP - (Date.now() - lastRunAt);
    if (wait > 0) {
      setTimeout(() => syncNow(), wait);
      return Promise.resolve(false);
    }

    busy = true;
    lastRunAt = Date.now();
    return runSync()
      .catch((err) => {
        status = 'error';
        message = err.code === 'NO_TOKEN' ? '登录已失效，请重新登录' : (err.message || '同步失败');
        meta.pending = true;
        saveMeta();
        log('同步失败', err.code || '', err.message);
        emit();
        if (retries < 3) {
          const delay = [10000, 30000, 60000][retries];
          retries += 1;
          clearTimeout(retryTimer);
          retryTimer = setTimeout(() => syncNow(), delay);
        }
        return false;
      })
      .then((value) => {
        busy = false;
        if (queued) {
          queued = false;
          setTimeout(() => syncNow(), 0);
        }
        return value;
      });
  }

  // 本地有改动：节流推送（答题中 60 秒内最多一次；force 用于完成测评等关键时刻）。
  function touch(force) {
    if (!meta.enabled || !user) return;
    if (status === 'syncing') {
      queued = true;
      return;
    }
    status = 'pending';
    meta.pending = true;
    saveMeta();
    emit();

    const wait = Math.max(0, DRAFT_PUSH_INTERVAL - (Date.now() - lastRunAt));
    if (force || wait === 0) {
      clearTimeout(draftTimer);
      draftTimer = null;
      syncNow();
      return;
    }
    if (!draftTimer) {
      draftTimer = setTimeout(() => {
        draftTimer = null;
        syncNow();
      }, wait);
    }
  }

  // ── 对外动作 ──
  function login() {
    if (sdk) sdk.requireLogin();
  }

  function enable() {
    meta.enabled = true;
    meta.disabledByUser = false;
    meta.version = 0;
    saveMeta();
    status = 'pending';
    message = '';
    emit();
    return syncNow();
  }

  function disable() {
    meta.enabled = false;
    meta.disabledByUser = true;
    meta.pending = false;
    saveMeta();
    status = 'off';
    message = '';
    emit();
  }

  function removeCloud() {
    return request('DELETE', 'profile').then((data) => {
      meta = { enabled: false, disabledByUser: true, version: 0, lastSyncAt: 0, pending: false };
      saveMeta();
      status = 'off';
      message = '';
      log('删除云端档案', data && data.deleted ? 'removed' : 'empty');
      emit();
      return true;
    });
  }

  function init() {
    if (!window.WPAccount || typeof window.WPAccount.load !== 'function') return;
    window.WPAccount.load().then((instance) => {
      sdk = instance;
      if (!sdk) {
        renderLine();
        return null;
      }
      return sdk.getUser().then((current) => {
        user = current;
        if (!user) {
          renderLine();
          return;
        }
        if (meta.enabled) {
          status = 'pending';
          emit();
          syncNow();
          return;
        }
        // 登录后默认自动开启一次同步；用户主动关闭过就不再自动打开
        if (!meta.disabledByUser) {
          enable().catch(() => {});
        } else {
          emit();
        }
      });
    }).catch((err) => {
      log('账户不可用，跳过同步', err && err.message);
    });

    // 回到前台 / 网络恢复时补一次
    window.addEventListener('online', () => {
      if (meta.enabled && meta.pending) syncNow();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && meta.enabled && meta.pending) syncNow();
    });

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', renderLine);
    } else {
      renderLine();
    }
  }

  window.WPSync = {
    init,
    state,
    onChange,
    enable,
    disable,
    syncNow,
    removeCloud,
    touch,
    login,
    _merge: mergeProfile
  };

  init();
})();
