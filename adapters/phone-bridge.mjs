// Injectable clients for phone-exec: the existing Jarvis bridge (HTTP) and a read-only foreground check (adb).
// Owner: sj-actions. These contain NO network or process code of their own: the server passes in
// `fetchImpl` (global fetch) and `execFileImpl` (the execFile function of Node's process module). That keeps adapters/ free of
// network/process APIs (the static safety scan still applies) and makes everything testable with fakes.
//
// Auth (no token.txt, no CORS tricks): the owner runs the bridge's own pair.ps1 and gives main a one-time pairing code.
// The client redeems it on LOOPBACK only (GET /pair?c=CODE, 302 + Set-Cookie jb=<device token>) and keeps the device
// token in a closure variable: never written to disk, never in an error message, a record or a log line.
// Reuses: E:\jarvis-aside-bridge\server.js /pair (lines ~580-589), /api/exec (~841-853), /api/runs (~639), principal() (~89-98).
import { parseForegroundFromDumpsys } from './phone-exec.mjs';

const LOOPBACK = new Set(['127.0.0.1', 'localhost']);
const DEFAULT_BASE = 'http://127.0.0.1:18700';

const bridgeError = (message, status, code) => Object.assign(new Error(message), { status, code });

/**
 * @param {{ fetchImpl: Function, baseUrl?: string, pairCode?: string }} o
 *   pairCode: one-time code from the owner's pair.ps1 (consumed on first use; a failed redemption is not retried)
 */
export function createBridgeClient({ fetchImpl, baseUrl = DEFAULT_BASE, pairCode } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl is required');
  const u = new URL(baseUrl);
  if (u.protocol !== 'http:' || !LOOPBACK.has(u.hostname)) throw new TypeError('the bridge client only talks to the local bridge on loopback');
  const base = u.origin;
  let deviceToken = null; // never exposed
  let code = typeof pairCode === 'string' && pairCode.trim() ? pairCode.trim() : null;
  let pairing = null;

  async function pair() {
    if (deviceToken) return;
    if (!code) throw bridgeError('not paired: no pairing code available', 401, 'not_paired');
    const used = code; code = null; // single use, whatever happens
    const r = await fetchImpl(`${base}/pair?c=${encodeURIComponent(used)}`, { redirect: 'manual' });
    const cookie = r.headers?.get?.('set-cookie') ?? '';
    const m = /(?:^|[,;\s])jb=([^;,\s]+)/.exec(cookie);
    if (r.status !== 302 || !m) throw bridgeError(`pairing failed (${r.status})`, r.status === 429 ? 429 : 401, 'pair_failed');
    deviceToken = decodeURIComponent(m[1]);
  }
  const ensurePaired = () => (deviceToken ? Promise.resolve() : (pairing ??= pair().finally(() => { pairing = null; })));
  const headers = () => ({ Authorization: `Bearer ${deviceToken}`, 'X-Jarvis': '1', 'Content-Type': 'application/json' });

  async function call(method, path, body) {
    await ensurePaired();
    const r = await fetchImpl(`${base}${path}`, { method, headers: headers(), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (r.status === 401 || r.status === 403) deviceToken = null; // revoked or wrong: do not keep using it
    if (!(r.status >= 200 && r.status < 300)) throw bridgeError(`bridge ${r.status}`, r.status, `bridge_${r.status}`);
    return r.json();
  }

  return {
    /** POST /api/exec. Only permission 'guard' is ever sent (the bridge's full-access mode is not available here). */
    async exec({ prompt, permission = 'guard' } = {}) {
      if (permission !== 'guard') throw bridgeError('only guard permission is allowed', 400, 'permission_refused');
      return call('POST', '/api/exec', { prompt, permission: 'guard' });
    },
    /** GET /api/runs, returns the run with this id (state running|done|failed) or null. */
    async run(runId) {
      const j = await call('GET', '/api/runs');
      return (j?.runs ?? []).find((x) => x.runId === runId) ?? null;
    },
    isPaired: () => !!deviceToken,
    describe: () => ({ base, paired: !!deviceToken, pairCodeAvailable: !!code }),
  };
}

export const ADB_FOREGROUND_ARGS = (serial) => ['-s', serial, 'shell', 'dumpsys activity activities'];

/**
 * Read-only foreground app check. The ONLY command this runs is `dumpsys activity activities` through adb.
 * No input, no app start, no screen capture, no file pull.
 */
export function createAdbForeground({ execFileImpl, serial, adbPath = 'adb', timeoutMs = 15000 } = {}) {
  if (typeof execFileImpl !== 'function') throw new TypeError('execFileImpl is required');
  // The serial is private runtime config (EBYS_PHONE_SERIAL, set by the server). There is deliberately no default.
  if (typeof serial !== 'string' || !/^[A-Za-z0-9_.:\-]{3,64}$/.test(serial)) throw new TypeError('serial is required (set EBYS_PHONE_SERIAL)');
  const args = ADB_FOREGROUND_ARGS(serial);
  return () => new Promise((resolve, reject) => {
    execFileImpl(adbPath, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (e, stdout) => {
      if (e) return reject(Object.assign(new Error('adb foreground check failed'), { code: 'adb_failed' }));
      resolve(parseForegroundFromDumpsys(String(stdout ?? '')));
    });
  });
}
