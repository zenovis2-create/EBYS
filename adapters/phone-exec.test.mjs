// Fakes only: no network, no phone, no bridge. Proves the truth rules of phone.exec-bridge.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhoneExecAdapter, parseForegroundFromDumpsys, DEVICE } from './phone-exec.mjs';

const CAL = { package: 'com.samsung.android.calendar', activity: 'com.samsung.android.app.calendar.view.MainActivity' };
const CHROME = { package: 'com.android.chrome', activity: 'com.google.android.apps.chrome.Main' };
const task = (o = {}) => ({ taskId: 'task_cal_1', revision: 1, kind: 'open_calendar', ...o });

function rig({ run = { runId: 'r1', state: 'running' }, fg = CHROME, execErr = null } = {}) {
  const state = { run, fg, execCalls: [], runCalls: 0, fgCalls: 0 };
  const adapter = createPhoneExecAdapter({
    now: () => '2026-11-09T14:20:00+09:00',
    bridge: {
      exec: async (req) => { state.execCalls.push(req); if (execErr) throw execErr; return { runId: 'r1', state: 'running' }; },
      run: async () => { state.runCalls++; if (state.run === 'throw') throw new Error('x'); return state.run; },
    },
    device: { foreground: async () => { state.fgCalls++; if (state.fg === 'throw') throw new Error('adb'); return state.fg; } },
  });
  return { adapter, state };
}
const confirmed = async (r, t = task()) => r.adapter.confirm({ task: t, previewDigest: r.adapter.preview(t).previewDigest });

test('parses the real dumpsys line', () => {
  const line = '    topResumedActivity=ActivityRecord{207054172 u0 com.android.chrome/com.google.android.apps.chrome.Main t6292}';
  assert.deepEqual(parseForegroundFromDumpsys(line), CHROME);
  assert.equal(parseForegroundFromDumpsys('nothing here'), null);
});

test('preview: exact prompt shown, guard permission, device named, nothing sent', () => {
  const r = rig();
  const p = r.adapter.preview(task());
  assert.equal(p.needs_clarification, false);
  assert.match(p.exactPrompt, /open the Calendar app/i);
  assert.match(p.exactPrompt, /Do not create, edit or delete any event/);
  assert.equal(p.permission, 'guard');
  assert.equal(p.display.device.en, DEVICE.model);
  assert.match(p.display.risk.en, /No event is created/);
  assert.equal(r.state.execCalls.length, 0, 'preview sends nothing');
  assert.equal(r.state.fgCalls, 0);
});

test('only the validated scenario is allowed; others are refused honestly, not faked', () => {
  const r = rig();
  const p = r.adapter.preview(task({ kind: 'send_message' }));
  assert.equal(p.ok, false); assert.equal(p.error.code, 'unsupported_task');
  assert.match(p.error.userHint.en, /Only opening the Calendar app has been checked/);
});

test('queued is NOT success: confirm returns executing, verifyLevel none, permission guard only', async () => {
  const r = rig();
  const rec = await confirmed(r);
  assert.equal(rec.status, 'executing'); assert.equal(rec.verifyLevel, 'none');
  assert.deepEqual(r.state.execCalls.map((c) => c.permission), ['guard']);
  assert.match(rec.readbackText.en, /Not confirmed yet/);
});

test('running + phone shows Calendar is still executing (not completed until the run is done)', async () => {
  const r = rig({ fg: CAL });
  const rec = await confirmed(r);
  const rb = await r.adapter.readback(rec.recordId);
  assert.equal(rb.status, 'executing');
  assert.match(rb.readbackText.en, /Still waiting/);
});

test('done + independent foreground is Calendar => completed with device_readback', async () => {
  const r = rig({ fg: CHROME });
  const rec = await confirmed(r);
  r.state.run = { runId: 'r1', state: 'done', exitCode: 0, tail: 'I opened Calendar' };
  r.state.fg = CAL;
  const rb = await r.adapter.readback(rec.recordId);
  assert.equal(rb.status, 'completed'); assert.equal(rb.verifyLevel, 'device_readback');
  assert.equal(rb.readback.package, 'com.samsung.android.calendar'); assert.equal(rb.readback.source, 'device_foreground');
  assert.equal(rb.readback.alreadyOpenBefore, false);
  assert.match(rb.readbackText.en, /Calendar is now open on your Fold/);
  assert.doesNotMatch(rb.readbackText.en, /saved|added to your calendar|event/i);
});

test('agent says done but the phone shows another app => verify_mismatch, never completed', async () => {
  const r = rig();
  const rec = await confirmed(r);
  r.state.run = { runId: 'r1', state: 'done', exitCode: 0, tail: 'Done! Calendar is open.' };
  const rb = await r.adapter.readback(rec.recordId);
  assert.equal(rb.status, 'verify_mismatch'); assert.equal(rb.verifyLevel, 'none');
  assert.match(rb.readbackText.en, /com\.android\.chrome, not Calendar/);
});

test('agent says done but the phone cannot be read => unknown_outcome, not success', async () => {
  const r = rig();
  const rec = await confirmed(r);
  r.state.run = { runId: 'r1', state: 'done', exitCode: 0 }; r.state.fg = 'throw';
  assert.equal((await r.adapter.readback(rec.recordId)).status, 'unknown_outcome');
});

test('already-open baseline is disclosed, not claimed as this task\'s doing', async () => {
  const r = rig({ fg: CAL });
  const rec = await confirmed(r);
  r.state.run = { runId: 'r1', state: 'done', exitCode: 0 };
  const rb = await r.adapter.readback(rec.recordId);
  assert.equal(rb.status, 'completed'); assert.equal(rb.readback.alreadyOpenBefore, true);
  assert.match(rb.readbackText.en, /already open before this task/);
});

test('bridge run failed => failed; bridge 401 => failed pre_send, nothing was sent, no retry loop', async () => {
  const r = rig();
  const rec = await confirmed(r);
  r.state.run = { runId: 'r1', state: 'failed', exitCode: 1 };
  assert.equal((await r.adapter.readback(rec.recordId)).status, 'failed');

  const r2 = rig({ execErr: Object.assign(new Error('unauthorized'), { status: 401 }) });
  const f = await confirmed(r2);
  assert.equal(f.status, 'failed'); assert.equal(f.error.phase, 'pre_send'); assert.equal(f.error.retryable, false);
  assert.match(f.readbackText.en, /Nothing was sent to your phone/);
  assert.equal(f.verifyLevel, 'none');
});

test('idempotent: confirming the same task twice queues one job; stale digest is rejected', async () => {
  const r = rig();
  const a = await confirmed(r);
  const b = await confirmed(r);
  assert.equal(b.deduplicated, true); assert.equal(b.recordId, a.recordId);
  assert.equal(r.state.execCalls.length, 1);
  const stale = await rig().adapter.confirm({ task: task(), previewDigest: 'deadbeef' });
  assert.equal(stale.ok, false); assert.equal(stale.error.code, 'stale_preview');
});

test('describe() is honest: unverified until live evidence, one validated task, no OS calendar claim', () => {
  const d = rig().adapter.describe();
  assert.equal(d.claimStatus, 'unverified'); assert.deepEqual(d.validatedTasks, ['open_calendar']);
  assert.match(d.notes, /does not save OS calendar events/);
});
