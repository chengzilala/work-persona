// 三面 · 云端同步服务（P1）
// 只做一件事：按统一账户中心核出的 uid 存取一份测评档案（历史 / 草稿 / 设置）。
// 零依赖：Node 内置 http + node:sqlite；Token 校验转发账户中心 me，不解析、不落盘。
//
// 环境变量：
//   PORT              监听端口（默认 8944，只绑 127.0.0.1，由 Caddy 反代 /wp-sync/*）
//   DB_FILE           SQLite 文件（默认 ./data/wp-sync.db）
//   ACCOUNT_CENTER    账户中心地址（默认 https://account.chesterlee.cn）
//   ALLOWED_ORIGINS   允许跨域的页面来源，逗号分隔
// 用法：node server/wp-sync.js
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT || 8944);
const HOST = process.env.HOST || '127.0.0.1';
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'data', 'wp-sync.db');
const ACCOUNT_CENTER = String(process.env.ACCOUNT_CENTER || 'https://account.chesterlee.cn').replace(/\/+$/, '');
const ORIGINS = String(process.env.ALLOWED_ORIGINS || [
  'https://persona.chesterlee.cn',
  'http://localhost:8930',
  'http://127.0.0.1:8930'
].join(','))
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

const MAX_BYTES = 256 * 1024; // 单档案上限 256 KB
const WRITE_PER_MINUTE = 10; // 单 uid 每分钟写次数
const TOKEN_TTL = 5 * 60 * 1000; // uid 缓存 5 分钟

const log = (...args) => console.log('[wp-sync]', ...args);
const uidTag = (uid) => crypto.createHash('sha256').update(String(uid)).digest('hex').slice(0, 8);

// ── 存储 ─────────────────────────────────────────
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
const db = new DatabaseSync(DB_FILE);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS wp_profiles (
    uid TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    version INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`);

const selectRow = db.prepare('SELECT payload, version, updated_at FROM wp_profiles WHERE uid = ?');
const upsertRow = db.prepare(`
  INSERT INTO wp_profiles (uid, payload, version, updated_at) VALUES (?, ?, ?, ?)
  ON CONFLICT(uid) DO UPDATE SET payload = excluded.payload, version = excluded.version, updated_at = excluded.updated_at
`);
const deleteRow = db.prepare('DELETE FROM wp_profiles WHERE uid = ?');

// ── 小工具 ───────────────────────────────────────
class HttpError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

function corsHeaders(origin) {
  const allow = origin && ORIGINS.includes(origin) ? origin : '';
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin'
  };
  if (allow) headers['Access-Control-Allow-Origin'] = allow;
  return headers;
}

function send(res, status, body, origin) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
    ...corsHeaders(origin)
  });
  res.end(text);
}

const ok = (res, data, origin) => send(res, 200, { ok: true, data }, origin);
const fail = (res, status, code, message, origin, extra) =>
  send(res, status, { ok: false, code, message, ...(extra || {}) }, origin);

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooBig = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      // 超限后不再缓存，只读完连接，避免把内存打满
      if (size > MAX_BYTES) {
        tooBig = true;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooBig) {
        reject(new HttpError(413, 'PAYLOAD_TOO_LARGE', '数据超过 256KB，暂时无法同步'));
        return;
      }
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}

// ── 身份：把 Token 交给账户中心核 uid，本服务不存 Token ──
const tokenCache = new Map(); // hash -> { uid, exp }

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function resolveUid(token) {
  const key = hashToken(token);
  const hit = tokenCache.get(key);
  if (hit && hit.exp > Date.now()) return hit.uid;

  let res;
  try {
    res = await fetch(`${ACCOUNT_CENTER}/accountCenter`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'me' }),
      signal: AbortSignal.timeout(8000)
    });
  } catch (err) {
    log('账户中心不可达', err.message);
    throw new HttpError(503, 'ACCOUNT_UNAVAILABLE', '账户服务暂时不可用，请稍后再试');
  }

  const data = await res.json().catch(() => null);
  if (res.status === 429) {
    throw new HttpError(429, 'RATE_LIMITED', '请求太频繁，请稍后再试');
  }
  if (!res.ok || !data || data.ok !== true || !data.data || !data.data.uid) {
    throw new HttpError(401, (data && data.code) || 'UNAUTHORIZED', '登录已失效，请重新登录');
  }

  const uid = String(data.data.uid);
  tokenCache.set(key, { uid, exp: Date.now() + TOKEN_TTL });
  if (tokenCache.size > 2000) {
    const now = Date.now();
    for (const [k, v] of tokenCache) if (v.exp <= now) tokenCache.delete(k);
  }
  return uid;
}

function bearer(req) {
  const raw = String(req.headers.authorization || '');
  const match = /^Bearer\s+(.+)$/i.exec(raw.trim());
  if (!match) throw new HttpError(401, 'UNAUTHORIZED', '请先登录');
  return match[1].trim();
}

// ── 写限流（单 uid 每分钟 10 次）──
const writeLog = new Map(); // uid -> number[]

function takeWrite(uid) {
  const now = Date.now();
  const list = (writeLog.get(uid) || []).filter((at) => now - at < 60000);
  if (list.length >= WRITE_PER_MINUTE) {
    writeLog.set(uid, list);
    throw new HttpError(429, 'RATE_LIMITED', '同步太频繁，请一分钟后再试');
  }
  list.push(now);
  writeLog.set(uid, list);
}

// ── 档案校验：只收约定的三个部分，其余丢弃 ──
const STAGE_KEYS = ['natural', 'work', 'stress'];

function cleanSettings(input) {
  const src = input && typeof input === 'object' ? input : {};
  return {
    nickname: String(src.nickname || '').slice(0, 12),
    updatedAt: Number(src.updatedAt) || 0
  };
}

function cleanDraft(input) {
  if (!input || typeof input !== 'object' || !input.answers || typeof input.answers !== 'object') return null;
  return {
    answers: input.answers,
    cursor: Number(input.cursor) || 0,
    stage: STAGE_KEYS.includes(input.stage) ? input.stage : 'natural',
    updatedAt: Number(input.updatedAt) || 0,
    version: Number(input.version) || 1
  };
}

function cleanHistory(input) {
  if (!Array.isArray(input)) return [];
  return input
    .filter((item) => item && typeof item === 'object' && item.id && item.createdAt && item.code && item.byStage)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 50);
}

function cleanProfile(input) {
  if (!input || typeof input !== 'object') return null;
  return {
    settings: cleanSettings(input.settings),
    draft: cleanDraft(input.draft),
    history: cleanHistory(input.history),
    updatedAt: Number(input.updatedAt) || 0
  };
}

// ── 接口 ─────────────────────────────────────────
async function handleLoad(req, res, origin) {
  const uid = await resolveUid(bearer(req));
  const row = selectRow.get(uid);
  if (!row) {
    log('load', uidTag(uid), 'empty');
    return ok(res, { version: 0, updatedAt: 0, profile: null }, origin);
  }
  let profile = null;
  try {
    profile = JSON.parse(row.payload);
  } catch (err) {
    log('load', uidTag(uid), 'payload broken');
  }
  log('load', uidTag(uid), `v${row.version}`);
  ok(res, { version: row.version, updatedAt: row.updated_at, profile }, origin);
}

async function handleSave(req, res, origin) {
  const uid = await resolveUid(bearer(req));
  const text = await readBody(req);
  let body = null;
  try {
    body = JSON.parse(text || '{}');
  } catch (err) {
    throw new HttpError(400, 'INVALID_PARAM', '数据格式不对，暂时无法同步');
  }

  const profile = cleanProfile(body.profile);
  if (!profile) throw new HttpError(400, 'INVALID_PARAM', '数据格式不对，暂时无法同步');
  const baseVersion = Number(body.baseVersion) || 0;

  const row = selectRow.get(uid);
  const currentVersion = row ? row.version : 0;
  if (currentVersion !== baseVersion) {
    let remote = null;
    try {
      remote = row ? JSON.parse(row.payload) : null;
    } catch (err) {
      remote = null;
    }
    log('save', uidTag(uid), 'conflict', `${baseVersion}->${currentVersion}`);
    return send(res, 409, {
      ok: false,
      code: 'CONFLICT',
      message: '云端已有更新，正在合并',
      data: { version: currentVersion, updatedAt: row ? row.updated_at : 0, profile: remote }
    }, origin);
  }

  takeWrite(uid);
  const version = currentVersion + 1;
  const now = Date.now();
  upsertRow.run(uid, JSON.stringify(profile), version, now);
  log('save', uidTag(uid), `v${version}`, `${Buffer.byteLength(text)}B`);
  ok(res, { version, updatedAt: now }, origin);
}

async function handleDelete(req, res, origin) {
  const uid = await resolveUid(bearer(req));
  const info = deleteRow.run(uid);
  log('delete', uidTag(uid), info.changes ? 'removed' : 'empty');
  ok(res, { deleted: info.changes > 0 }, origin);
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || '';
  const url = new URL(req.url, 'http://localhost');
  const route = url.pathname.replace(/\/+$/, '') || '/';

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(origin));
    res.end();
    return;
  }

  try {
    if (route === '/wp-sync/healthz' && req.method === 'GET') {
      return ok(res, { ok: true, uptime: Math.round(process.uptime()) }, origin);
    }
    if (route === '/wp-sync/load' && req.method === 'GET') {
      return await handleLoad(req, res, origin);
    }
    if (route === '/wp-sync/save' && req.method === 'POST') {
      return await handleSave(req, res, origin);
    }
    if (route === '/wp-sync/profile' && req.method === 'DELETE') {
      return await handleDelete(req, res, origin);
    }
    return fail(res, 404, 'NOT_FOUND', '接口不存在', origin);
  } catch (err) {
    if (err instanceof HttpError) {
      if (err.status >= 500) log('error', err.status, err.code, err.message);
      else log('reject', err.status, err.code);
      return fail(res, err.status, err.code, err.message, origin);
    }
    log('error', 'internal', err.message);
    return fail(res, 500, 'INTERNAL', '服务端异常，请稍后再试', origin);
  }
});

server.listen(PORT, HOST, () => {
  log(`listening http://${HOST}:${PORT}`);
  log(`db ${DB_FILE}`);
  log(`account ${ACCOUNT_CENTER}`);
});

function shutdown(signal) {
  log('shutdown', signal);
  server.close(() => {
    try {
      db.close();
    } catch (err) {
      /* 关闭失败不影响退出 */
    }
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
