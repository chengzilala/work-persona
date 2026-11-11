// 统一账户接入（仅身份）：加载账户中心 SDK，渲染右上角登录入口。
// SDK 加载失败或账户服务不可用时保持普通页面，不阻塞测评主流程。
(() => {
  'use strict';

  const PRODUCT_ID = 'work-persona';
  const ACCOUNT_PROD = 'https://account.chesterlee.cn';
  const ACCOUNT_PAGE_LOCAL = 'http://localhost:18830';
  const ACCOUNT_API_LOCAL = 'http://localhost:8942';

  const isLocal = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  const accountWeb = () => (isLocal ? ACCOUNT_PAGE_LOCAL : ACCOUNT_PROD);
  const accountApi = () => (isLocal ? ACCOUNT_API_LOCAL : ACCOUNT_PROD);

  // 本机页面在 18830、接口在 8942，接口不托管页面；SDK 静默登录会跳到
  // apiBase + /sso.html（即 8942），必然 404。故本机禁用静默登录，只走手动「登录」。
  if (isLocal) {
    try { localStorage.setItem('ps_sso_off', '1'); } catch (err) { /* 存不了不影响主流程 */ }
  }

  function loadAuthSdk() {
    if (window.__wpAuthSdkReady) return window.__wpAuthSdkReady;
    window.__wpAuthSdkReady = new Promise((resolve) => {
      if (!accountWeb() || !accountApi()) { resolve(null); return; }
      const script = document.createElement('script');
      script.src = './assets/js/ps-auth.js';
      script.onload = () => {
        if (!window.PSAuth) { resolve(null); return; }
        window.PSAuth.init({
          apiBase: accountApi(),
          loginUrl: accountWeb() + '/login.html',
          productId: PRODUCT_ID
        });
        resolve(window.PSAuth);
      };
      script.onerror = () => resolve(null);
      document.head.appendChild(script);
    });
    return window.__wpAuthSdkReady;
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // 只接受图片 url 或 data 图片，避免把任意字符串塞进 src。
  function safeAvatar(url) {
    const text = String(url || '').trim();
    if (/^data:image\//i.test(text) || /^https?:\/\//i.test(text)) return text;
    return '';
  }

  const GUEST_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="3.6"/><path d="M4.8 20a7.2 7.2 0 0 1 14.4 0"/></svg>';

  // 供主流程读取账户昵称：未登录 / SDK 不可用时统一返回 null。
  let resolveUser;
  const userReady = new Promise((resolve) => {
    resolveUser = resolve;
  });

  function renderEntry(el, user) {
    if (!user) {
      el.className = 'wp-account is-guest';
      el.innerHTML = `${GUEST_ICON}<span>登录</span>`;
      el.title = '登录 / 注册';
      el.setAttribute('aria-label', '登录或注册');
      return;
    }

    const name = String(user.nickname || '我的').trim() || '我的';
    const avatar = safeAvatar(user.avatar);
    const face = avatar
      ? `<img class="wp-account-avatar" src="${esc(avatar)}" alt="">`
      : `<span class="wp-account-avatar wp-account-avatar-text">${esc(name.slice(0, 1))}</span>`;

    el.className = 'wp-account is-user';
    el.innerHTML = `${face}<span class="wp-account-name">${esc(name)}</span>`;
    el.title = '进入我的账户';
    el.setAttribute('aria-label', `已登录：${name}，进入我的账户`);
  }

  function setupAccountEntry() {
    const el = document.getElementById('accountEntry');
    if (!el) {
      resolveUser(null);
      return;
    }
    loadAuthSdk().then((sdk) => {
      if (!sdk) {
        resolveUser(null);
        return null;
      }
      return sdk.getUser().then((user) => {
        resolveUser(user);
        el.hidden = false;
        renderEntry(el, user);
        el.onclick = () => {
          if (user) location.href = accountWeb() + '/account.html';
          else sdk.requireLogin();
        };
      });
    }).catch(() => {
      // 账户服务不可用：入口保持隐藏，主功能照常
      resolveUser(null);
    });
  }

  // 留给后续同步模块使用：同一套地址与 SDK 实例
  window.WPAccount = {
    productId: PRODUCT_ID,
    webBase: accountWeb,
    apiBase: accountApi,
    load: loadAuthSdk,
    userReady: () => userReady
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupAccountEntry);
  } else {
    setupAccountEntry();
  }
})();
