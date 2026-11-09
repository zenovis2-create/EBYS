// Fakes only. No network, no process, no phone. Proves auth handling, token hygiene and the read-only adb contract.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createBridgeClient, createAdbForeground, ADB_FOREGROUND_ARGS } from './phone-bridge.mjs';
import { createPhoneExecAdapter } from './phone-exec.mjs';

const TEST_SERIAL = 'TEST-SERIAL:0000'; // dummy: the real serial is private runtime config
const SECRET = 'DEVICE_TOKEN_SECRET_abc123';
const res = (status, { json, cookie } = {}) => ({ status, headers: { get: (h) => (h.toLowerCase() === 'set-cookie' ? cookie ?? null : null) }, json: async () => json });

function fakeBridge({ pairStatus = 302, execStatus = 202, runs = [] } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    const u = new URL(url);
    if (u.pathname === '/pair') return pairStatus === 302 ? res(302, { cookie: `jb=${SECRET}; HttpOnly; SameSite=Lax; Path=/` }) : res(pairStatus);
    const auth = init.headers?.Authorization;
    if (auth !== `Bearer ${SECRET}`) return res(401);
    if (u.pathname === '/api/exec') return res(execStatus, { json: { runId: 'run1', state: 'running' } });
    if (u.pathname === '/api/runs') return res(200, { json: { runs } });
    return res(404);
  };
  return { fetchImpl, calls };
}

test('only the local bridge on loopback is allowed', () => {
  const f = async () => res(200);
  for (const bad of ['https://bridge.example.test:8447', 'http://lan-host.invalid:18700', 'http://example.com']) assert.throws(() => createBridgeClient({ fetchImpl: f, baseUrl: bad }), /loopback/);
  assert.doesNotThrow(() => createBridgeClient({ fetchImpl: f, baseUrl: 'http://localhost:18700' }));
});

test('pairs once with the owner code, then sends the device token, X-Jarvis and guard only', async () => {
  const b = fakeBridge();
  const c = createBridgeClient({ fetchImpl: b.fetchImpl, pairCode: 'ABC123DEF456' });
  assert.equal(c.isPaired(), false);
  const r = await c.exec({ prompt: 'open calendar' });
  assert.equal(r.runId, 'run1'); assert.equal(c.isPaired(), true);
  const pairCall = b.calls[0]; assert.match(pairCall.url, /^http:\/\/127\.0\.0\.1:18700\/pair\?c=ABC123DEF456$/); assert.equal(pairCall.init.redirect, 'manual');
  const exec = b.calls[1]; assert.equal(exec.init.method, 'POST'); assert.equal(exec.init.headers['X-Jarvis'], '1');
  assert.deepEqual(JSON.parse(exec.init.body), { prompt: 'open calendar', permission: 'guard' });
  await c.exec({ prompt: 'again' });
  assert.equal(b.calls.filter((x) => x.url.includes('/pair')).length, 1, 'the code is redeemed once');
  assert.equal(c.describe().pairCodeAvailable, false);
});

test('full access is refused locally and never sent', async () => {
  const b = fakeBridge();
  const c = createBridgeClient({ fetchImpl: b.fetchImpl, pairCode: 'X' });
  await assert.rejects(() => c.exec({ prompt: 'x', permission: 'full-access' }), (e) => e.code === 'permission_refused');
  assert.equal(b.calls.length, 0);
});

test('no pairing code => 401-style error, nothing is sent to /api/exec', async () => {
  const b = fakeBridge();
  const c = createBridgeClient({ fetchImpl: b.fetchImpl });
  await assert.rejects(() => c.exec({ prompt: 'x' }), (e) => e.status === 401 && e.code === 'not_paired');
  assert.equal(b.calls.length, 0);
});

test('failed pairing (wrong/expired code) is not retried with the same code and reports 401', async () => {
  const b = fakeBridge({ pairStatus: 401 });
  const c = createBridgeClient({ fetchImpl: b.fetchImpl, pairCode: 'WRONG' });
  await assert.rejects(() => c.exec({ prompt: 'x' }), (e) => e.status === 401);
  await assert.rejects(() => c.exec({ prompt: 'x' }), (e) => e.code === 'not_paired');
  assert.equal(b.calls.length, 1);
});

test('run(): finds the run by id, null when unknown', async () => {
  const b = fakeBridge({ runs: [{ runId: 'run1', state: 'done', exitCode: 0 }] });
  const c = createBridgeClient({ fetchImpl: b.fetchImpl, pairCode: 'X' });
  assert.equal((await c.run('run1')).state, 'done');
  assert.equal(await c.run('nope'), null);
});

test('adb foreground runs only the read-only dumpsys command and parses it', async () => {
  const seen = [];
  const execFileImpl = (file, args, opts, cb) => { seen.push({ file, args }); cb(null, '  topResumedActivity=ActivityRecord{1 u0 com.samsung.android.calendar/com.samsung.android.app.calendar.view.MainActivity t9}'); };
  const fg = await createAdbForeground({ execFileImpl, serial: TEST_SERIAL })();
  assert.deepEqual(fg, { package: 'com.samsung.android.calendar', activity: 'com.samsung.android.app.calendar.view.MainActivity' });
  assert.deepEqual(seen[0].args, ADB_FOREGROUND_ARGS(TEST_SERIAL));
  const joined = seen[0].args.join(' ');
  assert.doesNotMatch(joined, /\b(input|am start|monkey|screencap|pull|push|install|uninstall|connect|call|sms)\b/);
  await assert.rejects(() => createAdbForeground({ execFileImpl: (f, a, o, cb) => cb(new Error('boom')), serial: TEST_SERIAL })(), (e) => e.code === 'adb_failed');
});

test('end to end with fakes: confirm -> run done -> independent foreground => completed; the token never leaks', async () => {
  const b = fakeBridge();
  const state = { runs: [{ runId: 'run1', state: 'running' }], fgOut: 'topResumedActivity=ActivityRecord{1 u0 com.android.chrome/com.google.android.apps.chrome.Main t1}' };
  const fetchImpl = async (url, init) => { const r = await b.fetchImpl(url, init); return new URL(url).pathname === '/api/runs' ? res(200, { json: { runs: state.runs } }) : r; };
  const adapter = createPhoneExecAdapter({
    now: () => '2026-11-09T15:00:00+09:00',
    bridge: createBridgeClient({ fetchImpl, pairCode: 'ABC123DEF456' }),
    device: { foreground: createAdbForeground({ execFileImpl: (f, a, o, cb) => cb(null, state.fgOut), serial: TEST_SERIAL }) },
  });
  const task = { taskId: 't1', revision: 1, kind: 'open_calendar' };
  const rec = await adapter.confirm({ task, previewDigest: adapter.preview(task).previewDigest });
  assert.equal(rec.status, 'executing');
  state.runs = [{ runId: 'run1', state: 'done', exitCode: 0, tail: 'Calendar is open' }];
  state.fgOut = 'topResumedActivity=ActivityRecord{2 u0 com.samsung.android.calendar/x.Main t2}';
  const done = await adapter.readback(rec.recordId);
  assert.equal(done.status, 'completed'); assert.equal(done.verifyLevel, 'device_readback');
  const everything = JSON.stringify([rec, done, adapter.list(), adapter.describe()]);
  assert.ok(!everything.includes(SECRET), 'device token must never appear in records');
  assert.ok(!everything.includes('ABC123DEF456'), 'pairing code must never appear in records');
});

test('end to end with fakes: unpaired bridge => failed pre_send, record has no secret, phone untouched', async () => {
  const b = fakeBridge();
  const adapter = createPhoneExecAdapter({
    bridge: createBridgeClient({ fetchImpl: b.fetchImpl }),
    device: { foreground: async () => null },
  });
  const task = { taskId: 't2', revision: 1, kind: 'open_calendar' };
  const rec = await adapter.confirm({ task, previewDigest: adapter.preview(task).previewDigest });
  assert.equal(rec.status, 'failed'); assert.equal(rec.error.phase, 'pre_send');
  assert.equal(b.calls.filter((c) => c.url.includes('/api/exec')).length, 0);
});

test('the adb serial has no committed default: it must be supplied (EBYS_PHONE_SERIAL), and is validated', () => {
  const execFileImpl = (f, a, o, cb) => cb(null, '');
  assert.throws(() => createAdbForeground({ execFileImpl }), /serial is required/);
  assert.throws(() => createAdbForeground({ execFileImpl, serial: '' }), /serial is required/);
  assert.throws(() => createAdbForeground({ execFileImpl, serial: 'x; rm -rf /' }), /serial is required/);
  assert.doesNotThrow(() => createAdbForeground({ execFileImpl, serial: TEST_SERIAL }));
});

test('public repo hygiene: no personal network identifier is committed anywhere in adapters/', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const IPV4 = /\b(?!127\.0\.0\.1\b)\d{1,3}(?:\.\d{1,3}){3}\b/;
  for (const f of readdirSync(here).filter((x) => /\.(mjs|md)$/.test(x) && x !== 'phone-bridge.test.mjs')) { // this file holds the patterns themselves
    const src = readFileSync(join(here, f), 'utf8');
    // allow dotted version/date-like strings only if they are not valid IPv4 octets
    const m = src.match(new RegExp(IPV4.source, 'g'))?.filter((s) => s.split('.').every((n) => Number(n) <= 255 && String(Number(n)) === n));
    assert.deepEqual(m ?? [], [], `${f} contains an IPv4 address`);
    assert.doesNotMatch(src, /\.ts\.net\b|tailscale ip|\b100\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/i, `${f} contains a tailnet identifier`);
    assert.doesNotMatch(src, /Bearer [A-Za-z0-9_-]{20,}/, `${f} contains a bearer token`);
  }
});