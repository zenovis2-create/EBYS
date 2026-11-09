// EBYS local server: static ui/ + mockup/ and JSON endpoints. Model calls stay server-side.
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCursorLlm } from './llm/router.mjs';
import { createFlow } from './app/flow.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const HOST = process.env.EBYS_HOST ?? '127.0.0.1';
const PORT = Number(process.env.EBYS_PORT ?? 8787);
const MAX_BODY = 64 * 1024;

const llm = createCursorLlm({ cwd: ROOT });
const flow = createFlow({ llm, calendarMode: process.env.EBYS_CALENDAR ?? 'simulated' });

// Server-side modules are loaded once; ui/ is served from disk per request. Footage must cite both.
async function snapshot(dirs, files = []) {
  const list = [...files];
  for (const d of dirs) {
    for (const e of await readdir(path.join(ROOT, d), { recursive: true, withFileTypes: true })) {
      if (e.isFile() && /\.(m?js|html|css|json)$/.test(e.name) && !/\.test\.mjs$/.test(e.name)) {
        list.push(path.relative(ROOT, path.join(e.parentPath ?? e.path, e.name)).replaceAll('\\', '/'));
      }
    }
  }
  list.sort();
  const h = createHash('sha256');
  for (const f of list) h.update(`${f}\0`).update(await readFile(path.join(ROOT, f))).update('\0');
  return { sha256: h.digest('hex'), files: list.length };
}
const SERVER_CODE = { dirs: ['core', 'adapters', 'app', 'llm', 'contracts'], files: ['server.mjs'] };
const loaded = { startedAt: new Date().toISOString(), ...(await snapshot(SERVER_CODE.dirs, SERVER_CODE.files)) };
async function runtime() {
  const disk = await snapshot(SERVER_CODE.dirs, SERVER_CODE.files);
  return {
    ...flow.runtime(),
    sourceSnapshot: {
      serverLoaded: loaded,
      serverOnDisk: disk,
      serverCurrent: disk.sha256 === loaded.sha256,
      uiOnDisk: await snapshot(['ui']),
    },
  };
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const STATIC_DIRS = new Set(['ui', 'mockup', 'contracts']);

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(body);
}
const sendJson = (res, result) => {
  if (result && result.ok === false) return send(res, result.error?.code === 'not_found' ? 404 : 400, JSON.stringify(result));
  return send(res, 200, JSON.stringify({ ok: true, data: result }));
};

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw Object.assign(new Error('body too large'), { status: 413 });
    chunks.push(c);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const routes = [
  ['POST', /^\/api\/ingest$/, (b) => flow.ingest(b)],
  ['GET', /^\/api\/memories$/, () => flow.memories()],
  ['POST', /^\/api\/query$/, (b) => flow.query(b)],
  ['POST', /^\/api\/propose$/, (b) => flow.propose(b)],
  ['POST', /^\/api\/proposal\/([^/]+)\/cancel$/, (b, m) => flow.cancelProposal(decodeURIComponent(m[1]))],
  ['POST', /^\/api\/proposal\/([^/]+)$/, (b, m) => flow.updateProposal(decodeURIComponent(m[1]), b.patch ?? {})],
  ['POST', /^\/api\/preview$/, (b) => flow.preview(b)],
  ['POST', /^\/api\/confirm$/, (b) => flow.confirm(b)],
  ['GET', /^\/api\/records$/, () => flow.records()],
  ['POST', /^\/api\/summary$/, (b) => flow.summary(b)],
  ['POST', /^\/api\/delete$/, (b) => flow.remove(b)],
  ['GET', /^\/api\/runtime$/, () => runtime()],
];

async function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname).replace(/^\/+/, '');
  if (rel === '' || rel.endsWith('/')) rel += 'index.html';
  // "/" serves ui/index.html, so its relative assets (/app.js, /styles.css) resolve inside ui/.
  if (!STATIC_DIRS.has(rel.split('/')[0])) rel = `ui/${rel}`;
  const top = rel.split('/')[0];
  const file = path.resolve(ROOT, rel);
  if (!file.startsWith(path.join(ROOT, top) + path.sep) || /^ui\/(test|tools)\//.test(rel)) return send(res, 404, 'not found', 'text/plain');
  try {
    const body = await readFile(file);
    send(res, 200, body, TYPES[path.extname(file)] ?? 'application/octet-stream');
  } catch {
    send(res, 404, 'not found', 'text/plain');
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local');
  try {
    if (url.pathname.startsWith('/api/')) {
      const route = routes.find(([m, re]) => m === req.method && re.test(url.pathname));
      if (!route) return send(res, 404, JSON.stringify({ ok: false, error: { code: 'not_found', message: 'no such endpoint' } }));
      if (req.method === 'POST' && !String(req.headers['content-type'] ?? '').includes('application/json')) {
        return send(res, 415, JSON.stringify({ ok: false, error: { code: 'json_only', message: 'send application/json' } }));
      }
      const body = req.method === 'POST' ? await readJson(req) : {};
      const result = await route[2](body, url.pathname.match(route[1]));
      return sendJson(res, result);
    }
    if (req.method !== 'GET') return send(res, 405, 'method not allowed', 'text/plain');
    // The UI defaults to fixtures; the canonical entry on this server is the live model-backed app.
    if ((url.pathname === '/' || url.pathname === '/ui/') && !url.searchParams.has('api')) {
      url.searchParams.set('api', 'live');
      res.writeHead(302, { location: `/${url.search}`, 'cache-control': 'no-store' });
      return res.end();
    }
    return serveStatic(req, res, url.pathname);
  } catch (e) {
    const status = e.status ?? (e instanceof SyntaxError ? 400 : 500);
    send(res, status, JSON.stringify({ ok: false, error: { code: status === 500 ? 'internal' : 'bad_request', message: String(e.message ?? e), retryable: status === 500 } }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`EBYS listening on http://${HOST}:${PORT}  (model route: ${llm.describe().route}/${llm.describe().model}, calendar: ${process.env.EBYS_CALENDAR ?? 'simulated'})`);
});
