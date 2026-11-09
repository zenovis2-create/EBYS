// phone.exec-bridge: EBYS task preview -> confirm -> existing Jarvis bridge /api/exec -> Aside -> use-phone,
// then an INDEPENDENT foreground readback from the device. Owner: sj-actions (execution + readback only).
//
// Reuse, not a new engine: the actual work is done by the existing bridge route
// (E:\jarvis-aside-bridge\server.js, POST /api/exec, permission 'guard' only, lines ~841-853; runs via GET /api/runs).
// This module never reads token.txt, devices.json or any credential. The caller (main's server code) injects:
//   bridge.exec({ prompt, permission })  -> { runId, state }            (POST /api/exec, authenticated by main)
//   bridge.run(runId)                    -> { runId, state, exitCode, tail }   (GET /api/runs, find by runId)
//   device.foreground()                  -> { package, activity }       (read-only, e.g. adb dumpsys topResumedActivity)
// so this file has no network, process or credential code and the adapters static safety scan still applies.
//
// Truth rules: a queued job is never success; an agent's self-report (run output) is never success.
// 'completed' requires: run state 'done' AND the device foreground package is the Calendar app AND
// that was read by device.foreground(), not by the agent. Scope proven: opening Calendar only. Nothing else.
import { createHash } from 'node:crypto';
import { canonicalJson } from '../contracts/contracts.js';
import { toKstIso } from './format.mjs';
import { findForbiddenOutput } from './safety.mjs';

export const PHONE_ADAPTER_ID = 'phone.exec-bridge';
// Model name only. The device's network address/serial is private runtime config (EBYS_PHONE_SERIAL), injected by the server; never committed.
export const DEVICE = Object.freeze({ model: 'Samsung Galaxy Z Fold (SM-F971N)' });
export const CALENDAR_PACKAGES = Object.freeze(['com.samsung.android.calendar', 'com.google.android.calendar']);

/** Safe task catalogue. Only `open_calendar` is validated; anything else is refused here (not silently redefined). */
const TASKS = {
  open_calendar: {
    label: { en: 'Open the Calendar app on your Fold', ko: 'Fold에서 달력 앱 열기' },
    risk: { en: 'Low. Only opens an app. No event is created, changed or deleted. No calls, messages, purchases or settings changes.', ko: '낮음. 앱만 엽니다. 일정 생성/수정/삭제, 전화, 메시지, 구매, 설정 변경은 없습니다.' },
    prompt: `Using the phone tools, open the Calendar app on the connected Samsung Galaxy Z Fold (SM-F971N), then stop. `
      + 'Only open the app. Do not create, edit or delete any event, and do not change any setting. Do not make calls, send messages, or buy anything. '
      + 'When it is open, say which app is in the foreground.',
    expectPackages: CALENDAR_PACKAGES,
  },
};

const sha256 = (o) => createHash('sha256').update(canonicalJson(o)).digest('hex');
const isCalendar = (pkg) => CALENDAR_PACKAGES.includes(pkg);
const clone = (o) => structuredClone(o);
const err = (code, message, userHint, extra = {}) => ({ ok: false, error: { code, message, userHint, retryable: false, phase: 'pre_send', ...extra } });

/** Parse `dumpsys activity activities` output: "topResumedActivity=ActivityRecord{id u0 pkg/activity tNNN}". */
export function parseForegroundFromDumpsys(text) {
  const m = String(text ?? '').match(/(?:topResumedActivity|ResumedActivity)[^\n]*?u\d+\s+([A-Za-z0-9_.]+)\/([A-Za-z0-9_.$]+)/);
  return m ? { package: m[1], activity: m[2] } : null;
}

export function createPhoneExecAdapter({ now = () => new Date(), bridge, device } = {}) {
  if (!bridge?.exec || !bridge?.run) throw new TypeError('bridge.exec and bridge.run are required (injected by the server)');
  if (!device?.foreground) throw new TypeError('device.foreground is required (independent readback)');
  const nowIso = () => toKstIso(new Date(now()).getTime());
  /** @type {Map<string, any>} */ const records = new Map();
  const touch = (rec, status) => { rec.status = status; rec.updatedAt = nowIso(); rec.history.push({ at: rec.updatedAt, status }); };

  function describe() {
    return {
      id: PHONE_ADAPTER_ID, kind: 'phone_task', mode: 'real',
      label: { en: 'Run a task on your Fold through Jarvis', ko: 'Jarvis로 Fold에서 작업 실행' },
      device: DEVICE,
      route: 'existing Jarvis bridge POST /api/exec (permission guard) -> Aside -> use-phone',
      validatedTasks: ['open_calendar'],
      claimStatus: 'unverified', // becomes 'demonstrated' only after a live run with evidence (see handoff doc)
      maxVerifyLevel: 'device_readback',
      notes: 'Opening Calendar is the only scenario this adapter vouches for. It does not save OS calendar events.',
    };
  }

  function buildPreview(task) {
    const def = TASKS[task?.kind];
    if (!def) return err('unsupported_task', `task kind ${task?.kind} is not validated`,
      { en: 'This task is not available yet. Only opening the Calendar app has been checked.', ko: '이 작업은 아직 사용할 수 없습니다. 달력 앱 열기만 확인되었습니다.' });
    if (typeof task.taskId !== 'string' || !task.taskId || !Number.isInteger(task.revision) || task.revision < 1) return err('invalid_task', 'taskId and revision are required', { en: 'Something is missing in this request.', ko: '요청에 빠진 내용이 있습니다.' });
    const bad = findForbiddenOutput(def.prompt);
    if (bad) return err('forbidden_output', bad, { en: 'This task was blocked for safety.', ko: '안전을 위해 차단되었습니다.' });
    const payload = { taskId: task.taskId, revision: task.revision, kind: task.kind, prompt: def.prompt, permission: 'guard', device: DEVICE.model, adapterId: PHONE_ADAPTER_ID, mode: 'real' };
    return {
      ok: true,
      preview: {
        needs_clarification: false, taskId: task.taskId, revision: task.revision, kind: task.kind, adapterId: PHONE_ADAPTER_ID, mode: 'real',
        previewDigest: sha256(payload),
        display: { task: def.label, device: { en: DEVICE.model, ko: DEVICE.model }, risk: def.risk },
        exactPrompt: def.prompt, // shown to the user verbatim: this is exactly what will be sent
        permission: 'guard',
        summary: { en: `${def.label.en} (${DEVICE.model})`, ko: `${def.label.ko} (${DEVICE.model})` },
        modeLabel: { en: 'Runs on your phone through Jarvis. EBYS will check the phone screen afterwards.', ko: 'Jarvis를 통해 휴대폰에서 실행합니다. 끝나면 EBYS가 화면을 확인합니다.' },
        willNot: { en: ['create or change calendar events', 'call or message anyone', 'buy anything', 'change phone settings'], ko: ['일정 생성/변경', '전화/메시지', '구매', '설정 변경'] },
        warnings: [],
      },
      payload,
    };
  }

  function preview(task) { const b = buildPreview(task); return b.ok ? b.preview : b; }

  function text(rec) {
    const t = TASKS[rec.kind].label;
    switch (rec.status) {
      case 'completed':
        return { en: rec.readback.alreadyOpenBefore
          ? `Calendar is open on your Fold (it was already open before this task). Checked on the phone screen: ${rec.readback.package}.`
          : `Calendar is now open on your Fold. Checked on the phone screen: ${rec.readback.package}.`,
        ko: `Fold에서 달력이 열려 있습니다. 화면에서 확인함: ${rec.readback.package}.` };
      case 'executing': return { en: rec.readback?.package ? `Sent to your phone. The phone currently shows ${rec.readback.package}. Still waiting for Jarvis to finish.` : 'Sent to your phone. Waiting for Jarvis to finish. Not confirmed yet.', ko: '휴대폰으로 보냈습니다. 아직 확인되지 않았습니다.' };
      case 'verify_mismatch': return { en: `Jarvis says it finished, but your phone screen shows ${rec.readback?.package ?? 'something else'}, not Calendar. Please don't rely on it.`, ko: 'Jarvis는 끝났다고 하지만 휴대폰 화면은 달력이 아닙니다.' };
      case 'unknown_outcome': return { en: "We can't tell whether Calendar opened. Please look at your phone.", ko: '달력이 열렸는지 확인하지 못했습니다. 휴대폰을 직접 확인해 주세요.' };
      case 'failed': return { en: rec.error?.phase === 'pre_send' ? "That didn't go through. Nothing was sent to your phone." : "Jarvis could not finish this task. Please check your phone.", ko: '작업을 끝내지 못했습니다.' };
      default: return { en: `${t.en}: pending`, ko: `${t.ko}: 대기 중` };
    }
  }

  async function confirm({ task, previewDigest } = {}) {
    const b = buildPreview(task);
    if (!b.ok) return b;
    const opKey = `${task.taskId}:${task.revision}`;
    if (typeof previewDigest !== 'string' || !previewDigest) return err('digest_required', 'previewDigest is required', { en: 'Please review the task first.', ko: '먼저 내용을 확인해 주세요.' });
    if (b.preview.previewDigest !== previewDigest) return err('stale_preview', 'details changed after preview', { en: 'Something changed since you last looked. Please review again.', ko: '내용이 바뀌었습니다. 다시 확인해 주세요.' });
    const existing = records.get(opKey);
    if (existing) return { ...clone(existing), deduplicated: true }; // never queue the same task twice
    const t = nowIso();
    const rec = { recordId: `ph_${sha256({ opKey }).slice(0, 12)}`, taskId: task.taskId, revision: task.revision, opKey, kind: task.kind,
      adapterId: PHONE_ADAPTER_ID, mode: 'real', status: 'confirmed', verifyLevel: 'none', preview: b.preview, createdAt: t, updatedAt: t, history: [{ at: t, status: 'confirmed' }] };
    records.set(opKey, rec);
    let baseline = null;
    try { baseline = await device.foreground(); } catch { baseline = null; }
    rec.baseline = baseline;
    try {
      const run = await bridge.exec({ prompt: b.payload.prompt, permission: 'guard' });
      if (!run?.runId) throw Object.assign(new Error('bridge returned no runId'), { code: 'bridge_no_run' });
      rec.runId = run.runId;
      touch(rec, 'executing'); // queued only: NOT success
    } catch (e) {
      const status = e?.status;
      rec.error = { code: e?.code ?? (status ? `bridge_${status}` : 'bridge_unreachable'), message: String(e?.message ?? e).slice(0, 200), retryable: status === 401 ? false : true, phase: 'pre_send',
        userHint: status === 401 || status === 403
          ? { en: 'Jarvis did not accept this request (not signed in). Nothing was sent to your phone.', ko: 'Jarvis가 요청을 받지 않았습니다. 휴대폰으로 아무것도 전송되지 않았습니다.' }
          : { en: "Couldn't reach Jarvis. Nothing was sent to your phone.", ko: 'Jarvis에 연결하지 못했습니다. 아무것도 전송되지 않았습니다.' } };
      touch(rec, 'failed');
    }
    rec.readbackText = text(rec);
    return clone(rec);
  }

  async function readback(recordId) {
    const rec = [...records.values()].find((r) => r.recordId === recordId);
    if (!rec) return err('not_found', `no record ${recordId}`, { en: 'We could not find that task.', ko: '해당 작업을 찾지 못했습니다.' });
    // terminal states keep the evidence captured when they were reached (the screen may legitimately change later)
    if (!rec.runId || ['failed', 'completed', 'verify_mismatch'].includes(rec.status)) { rec.readbackText = text(rec); return clone(rec); }
    let run = null; let fg = null;
    try { run = await bridge.run(rec.runId); } catch { run = null; }
    try { fg = await device.foreground(); } catch { fg = null; }
    rec.readback = fg ? { package: fg.package, activity: fg.activity, checkedAt: nowIso(), source: 'device_foreground', alreadyOpenBefore: isCalendar(rec.baseline?.package) } : rec.readback;
    if (!run) { if (rec.status === 'executing') touch(rec, 'unknown_outcome'); }
    else if (run.state === 'running') { /* still working: stay 'executing', show what the phone shows */ }
    else if (run.state === 'failed') { rec.error = { code: 'run_failed', message: `bridge run failed (exit ${run.exitCode})`, retryable: false, phase: 'post_send' }; rec.verifyLevel = 'none'; touch(rec, 'failed'); }
    else if (run.state === 'done') {
      if (!fg) touch(rec, 'unknown_outcome'); // the agent said done but we cannot see the phone: not success
      else if (isCalendar(fg.package)) { rec.verifyLevel = 'device_readback'; touch(rec, 'completed'); }
      else { rec.verifyLevel = 'none'; rec.error = { code: 'foreground_mismatch', message: `foreground is ${fg.package}, expected Calendar`, retryable: false, phase: 'post_send' }; touch(rec, 'verify_mismatch'); }
    }
    rec.readbackText = text(rec);
    return clone(rec);
  }

  const list = () => [...records.values()].map(clone);
  return { preview, confirm, readback, list, describe };
}
