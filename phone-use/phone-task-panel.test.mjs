// Phone task panel tests. FAKES ONLY: no phone, adb, bridge, network or credentials are touched.
// The adapter under test is the real adapters/phone-exec.mjs (read-only import) with fake bridge/device transports.
// Run: node --test phone-use/phone-task-panel.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

class FNode {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.listeners = {}; this.dataset = {}; this.className = ''; this.parent = null; this.disabled = false; this._text = ''; }
  append(...kids) { for (const k of kids) { const n = typeof k === 'string' ? Object.assign(new FNode('#text'), { _text: k }) : k; n.parent = this; this.children.push(n); } }
  get firstChild() { return this.children[0] ?? null; }
  removeChild(c) { this.children.splice(this.children.indexOf(c), 1); return c; }
  setAttribute(k, v) { this.attrs[k] = v; if (k === 'disabled') this.disabled = true; }
  getAttribute(k) { return this.attrs[k] ?? null; }
  addEventListener(t, fn) { (this.listeners[t] ??= []).push(fn); }
  focus() { globalThis.document.activeElement = this; }
  get textContent() { return this.tag === '#text' ? this._text : this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { this.children = []; this.append(String(v)); }
  walk(out = []) { out.push(this); this.children.forEach((c) => c.walk(out)); return out; }
  click() { (this.listeners.click ?? []).forEach((f) => f({ target: this })); }
}
const head = new FNode('head');
globalThis.Node = FNode;
globalThis.document = { activeElement: null, head, createElement: (t) => new FNode(t), createTextNode: (s) => Object.assign(new FNode('#text'), { _text: s }) };

const { renderPhoneTaskPanel, createHttpPhoneTransport, DEFAULT_PATHS } = await import('../ui/modules/phone-task-panel.js');
const { createPhoneExecAdapter } = await import('../adapters/phone-exec.mjs');

const here = dirname(fileURLToPath(import.meta.url));
const tick = () => new Promise((r) => setImmediate(r));
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };
const buttons = (root, label) => root.walk().filter((n) => n.tag === 'button' && n.textContent === label);
const text = (root) => root.textContent;
const TASK = { taskId: 't1', revision: 1, kind: 'open_calendar' };
const CAL = { package: 'com.samsung.android.calendar', activity: '.MainActivity' };
const CHROME = { package: 'com.android.chrome', activity: '.Main' };

function fakeTimers() {
  const q = []; let id = 0;
  return { setTimer: (fn) => { q.push({ id: ++id, fn }); return id; }, clearTimer: (i) => { const k = q.findIndex((x) => x.id === i); if (k >= 0) q.splice(k, 1); },
    pending: () => q.length, fire: async () => { const t = q.shift(); await t?.fn(); await settle(); } };
}

/** Real adapter + fake bridge/device, exposed through the same shape main's /api/phone/* routes return. */
function fixture({ execError = null, fg = CAL } = {}) {
  const calls = { exec: 0 };
  const state = { run: { runId: 'r1', state: 'running' }, fg };
  const adapter = createPhoneExecAdapter({
    now: () => new Date('2026-11-09T14:35:00+09:00'),
    bridge: { exec: async () => { calls.exec++; if (execError) throw execError; return { runId: 'r1', state: 'running' }; }, run: async () => state.run },
    device: { foreground: async () => state.fg },
  });
  const transport = { preview: async (t) => adapter.preview(t), confirm: async (a) => adapter.confirm(a), readback: async (id) => adapter.readback(id) };
  return { adapter, transport, calls, state };
}

test('preview shows the exact prompt verbatim and sends nothing until the user confirms', async () => {
  const fx = fixture(); const T = fakeTimers();
  const root = renderPhoneTaskPanel({ transport: fx.transport, task: TASK, ...T });
  await settle();
  assert.equal(root.getState().phase, 'review');
  const exact = root.walk().find((n) => n.attrs['data-testid'] === 'exact');
  assert.equal(exact.textContent, fx.adapter.preview(TASK).exactPrompt);
  assert.match(text(root), /Open the Calendar app on your Fold/);
  assert.match(text(root), /guard/);
  assert.equal(fx.calls.exec, 0, 'nothing sent before confirm');
  assert.equal(buttons(root, 'Send to my phone').length, 1);
});

test('queued is NOT success: executing -> still running -> verified completed only with device readback', async () => {
  const fx = fixture(); const T = fakeTimers(); const results = [];
  const root = renderPhoneTaskPanel({ transport: fx.transport, task: TASK, onResult: (r) => results.push(r), ...T });
  await settle();
  buttons(root, 'Send to my phone')[0].click(); await settle();
  assert.equal(fx.calls.exec, 1);
  assert.equal(root.getState().phase, 'executing');
  assert.match(text(root), /Sent\. Not confirmed yet/);
  assert.doesNotMatch(text(root), /Done\. Checked/);
  assert.equal(results.length, 0);
  await T.fire(); // run still running
  assert.equal(root.getState().phase, 'executing');
  assert.equal(T.pending(), 1, 'keeps polling');
  fx.state.run = { runId: 'r1', state: 'done', exitCode: 0 };
  await T.fire();
  assert.equal(root.getState().phase, 'done');
  assert.match(text(root), /Done\. Checked on your phone/);
  assert.match(text(root), /com\.samsung\.android\.calendar/);
  assert.equal(results.length, 1);
  assert.equal(results[0].verifyLevel, 'device_readback');
  assert.equal(T.pending(), 0, 'polling stops at terminal');
});

test('agent says done but the phone shows another app -> shown as a mismatch, never success', async () => {
  const fx = fixture(); const T = fakeTimers();
  const root = renderPhoneTaskPanel({ transport: fx.transport, task: TASK, ...T });
  await settle(); buttons(root, 'Send to my phone')[0].click(); await settle();
  fx.state.run = { runId: 'r1', state: 'done' }; fx.state.fg = CHROME;
  await T.fire();
  assert.match(text(root), /Your phone shows something else/);
  assert.doesNotMatch(text(root), /Done\. Checked/);
  assert.equal(root.getState().record.status, 'verify_mismatch');
});

test('bridge 401 -> honest error, "Nothing was sent", no success wording', async () => {
  const fx = fixture({ execError: Object.assign(new Error('bridge 401'), { status: 401 }) }); const T = fakeTimers();
  const root = renderPhoneTaskPanel({ transport: fx.transport, task: TASK, ...T });
  await settle(); buttons(root, 'Send to my phone')[0].click(); await settle();
  assert.equal(root.getState().phase, 'done');
  assert.equal(root.getState().record.status, 'failed');
  assert.match(text(root), /That didn't finish/);
  assert.match(text(root), /Nothing was sent to your phone/);
});

test('a task the backend does not support (e.g. Calculator) is refused, nothing is sent', async () => {
  const fx = fixture(); const T = fakeTimers();
  const root = renderPhoneTaskPanel({ transport: fx.transport, task: { taskId: 'c1', revision: 1, kind: 'calculator_multiply' }, ...T });
  await settle();
  assert.equal(root.getState().phase, 'error');
  assert.match(text(root), /not available yet/);
  assert.match(text(root), /unsupported_task/);
  assert.equal(buttons(root, 'Send to my phone').length, 0);
  assert.equal(fx.calls.exec, 0);
});

test('a lying backend: completed without device_readback is shown as not checked', async () => {
  const transport = {
    preview: async () => ({ previewDigest: 'd', exactPrompt: 'do x', permission: 'guard', display: { task: { en: 'X' } } }),
    confirm: async () => ({ recordId: 'r', status: 'completed', verifyLevel: 'none', readbackText: { en: 'All good!' } }),
    readback: async () => { throw new Error('no'); },
  };
  const root = renderPhoneTaskPanel({ transport, task: TASK, ...fakeTimers() });
  await settle(); buttons(root, 'Send to my phone')[0].click(); await settle();
  assert.match(text(root), /Reported done, but not checked/);
  assert.doesNotMatch(text(root), /Done\. Checked on your phone/);
  assert.match(text(root), /do not rely on this/);
});

test('preview without previewDigest or exactPrompt is refused (cannot show exactly what is sent)', async () => {
  const transport = { preview: async () => ({ summary: { en: 'x' } }), confirm: async () => assert.fail('must not confirm'), readback: async () => ({}) };
  const root = renderPhoneTaskPanel({ transport, task: TASK, ...fakeTimers() });
  await settle();
  assert.equal(root.getState().phase, 'error');
  assert.match(text(root), /nothing can be sent/);
});

test('stale preview re-previews and requires a fresh confirmation', async () => {
  let previews = 0; let confirms = 0;
  const transport = {
    preview: async () => ({ previewDigest: `d${++previews}`, exactPrompt: 'p', permission: 'guard' }),
    confirm: async () => { confirms++; return { ok: false, error: { code: 'stale_preview', userHint: { en: 'Something changed since you last looked. Please review again.' } } }; },
    readback: async () => ({}),
  };
  const root = renderPhoneTaskPanel({ transport, task: TASK, ...fakeTimers() });
  await settle(); buttons(root, 'Send to my phone')[0].click(); await settle();
  assert.equal(previews, 2); assert.equal(confirms, 1);
  assert.equal(root.getState().phase, 'review');
  assert.match(text(root), /Something changed/);
});

test('double tap on confirm sends one confirm; network failure on confirm offers a safe retry', async () => {
  let confirms = 0;
  const transport = {
    preview: async () => ({ previewDigest: 'd', exactPrompt: 'p', permission: 'guard' }),
    confirm: async () => { confirms++; return confirms === 1 ? { ok: false, error: { code: 'network', message: 'down' } } : { recordId: 'r', status: 'executing', verifyLevel: 'none', deduplicated: true }; },
    readback: async () => ({ recordId: 'r', status: 'executing' }),
  };
  const T = fakeTimers();
  const root = renderPhoneTaskPanel({ transport, task: TASK, ...T });
  await settle();
  const b = buttons(root, 'Send to my phone')[0]; b.click(); b.click(); await settle();
  assert.equal(confirms, 1);
  assert.match(text(root), /Not sure it was sent/);
  assert.match(text(root), /will not send it twice/);
  buttons(root, 'Try again')[0].click(); await settle();
  assert.equal(confirms, 2);
  assert.equal(root.getState().phase, 'executing');
  assert.match(text(root), /already been sent/);
});

test('polling gives up claiming nothing: after maxPollMs it says still not confirmed', async () => {
  let clock = 0; const T = fakeTimers();
  const transport = { preview: async () => ({ previewDigest: 'd', exactPrompt: 'p' }), confirm: async () => ({ recordId: 'r', status: 'executing' }), readback: async () => ({ recordId: 'r', status: 'executing' }) };
  const root = renderPhoneTaskPanel({ transport, task: TASK, maxPollMs: 1000, now: () => clock, ...T });
  await settle(); buttons(root, 'Send to my phone')[0].click(); await settle();
  clock = 5000; await T.fire();
  assert.match(text(root), /Still not confirmed/);
  assert.equal(root.getState().phase, 'executing');
  assert.equal(buttons(root, 'Check again').length, 1);
});

test('cancel at preview sends nothing and fires onCancel; destroy stops polling', async () => {
  const fx = fixture(); const T = fakeTimers(); let cancelled = 0;
  const root = renderPhoneTaskPanel({ transport: fx.transport, task: TASK, onCancel: () => cancelled++, ...T });
  await settle(); buttons(root, 'Cancel')[0].click(); await settle();
  assert.equal(cancelled, 1); assert.equal(fx.calls.exec, 0); assert.equal(root.getState().phase, 'idle');
  root.setTask(TASK); await settle(); buttons(root, 'Send to my phone')[0].click(); await settle();
  assert.equal(T.pending(), 1); root.destroy(); assert.equal(T.pending(), 0);
});

test('HTTP transport: contract paths, JSON bodies, no credentials/auth headers, failures stay failures', async () => {
  const seen = [];
  const responses = [{ status: 200, body: { previewDigest: 'd' } }, { status: 200, body: { recordId: 'r' } }, { status: 200, body: { ok: false, error: { code: 'not_found' } } }, { status: 401, body: { ok: false, error: { code: 'x' } } }, { status: 502, body: null }];
  const fetchFn = async (url, init) => { seen.push({ url, init }); const r = responses.shift(); return { ok: r.status < 400, status: r.status, json: async () => { if (r.body === null) throw new Error('bad'); return r.body; } }; };
  const t = createHttpPhoneTransport({ fetchFn });
  assert.deepEqual(await t.preview(TASK), { previewDigest: 'd' });
  assert.deepEqual(await t.confirm({ task: TASK, previewDigest: 'd' }), { recordId: 'r' });
  assert.equal((await t.readback('a/b')).error.code, 'not_found');
  assert.equal((await t.readback('x')).ok, false);
  const last = await t.readback('y');
  assert.equal(last.error.code, 'http_502'); assert.equal(last.error.retryable, true);
  assert.equal(seen[0].url, DEFAULT_PATHS.preview);
  assert.equal(seen[1].url, DEFAULT_PATHS.confirm);
  assert.equal(seen[2].url, '/api/phone/readback/a%2Fb');
  assert.deepEqual(JSON.parse(seen[1].init.body), { task: TASK, previewDigest: 'd' });
  for (const s of seen) { assert.equal(s.init.credentials, 'same-origin'); assert.equal(Object.keys(s.init.headers ?? {}).some((k) => /authorization|x-jarvis|token/i.test(k)), false); }
  const down = createHttpPhoneTransport({ fetchFn: async () => { throw new Error('offline'); } });
  assert.equal((await down.preview(TASK)).error.code, 'network');
});

test('source hygiene: no innerHTML, bridge address, token or credential reads in the panel', () => {
  const src = readFileSync(join(here, '..', 'ui', 'modules', 'phone-task-panel.js'), 'utf8');
  for (const bad of [/innerHTML/, /18700/, /token\.txt/, /devices\.json/, /calendar\.json/, /EBYS_BRIDGE_TOKEN/, /process\.env/, /localStorage/, /full-access/, /confirmFullAccess/]) assert.doesNotMatch(src, bad, String(bad));
});
