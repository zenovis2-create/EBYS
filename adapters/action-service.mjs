// ActionService (CONTRACTS sections 5, 6a). Server-side (uses node:crypto). Owner: sj-actions.
//
// Contract notes:
//  - preview(intent) has no external effect and is deterministic for a given intent + injected clock.
//    Its only bookkeeping is remembering the highest revision seen per intentId (used to reject stale confirms)
//    and a read-only duplicate lookup in the ledger.
//  - confirm({ intent, previewDigest }) returns an ActionRecord on success paths (including failed/unknown ones),
//    and `{ ok:false, error:{code,message,retryable,phase,userHint} }` when it refused to act
//    (needs_clarification, stale_preview, digest_required, duplicate, proposal_inactive, invalid_intent).
//  - Idempotent on intentId:revision. A second confirm returns the first record (deduplicated:true) and never
//    executes again, EXCEPT a record that failed/was denied in phase pre_send with retryable:true, where confirm is the Retry.
//    post_send / timeout => unknown_outcome; confirm never re-executes it. Call readback(recordId) to reconcile first.
import { createHash } from 'node:crypto';
import { TZ, ACTION_STATUS, VERIFY_LEVEL, demoNow } from '../contracts/contracts.js';
import { cleanText, findForbiddenOutput } from './safety.mjs';
import { parseExactIso, toKstIso, displayDateTime, displayParts, displayOffset, readbackText, DEFAULT_LANG } from './format.mjs';
import { digestString } from './digest.mjs';
import { createSimulatedCalendarAdapter, createIcsHandoffAdapter, AdapterError } from './calendar-adapters.mjs';
import { createLocalCalendarAdapter } from './calendar-local.mjs';
import { createNotificationPreview } from './notification-preview.mjs';

export const FAULTS = Object.freeze(['permission_denied', 'network', 'timeout', 'api_500', 'mismatch', 'slow', 'lost_response']);
export const VERSION = 'actions-0.1.0';

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
export function computePreviewDigest(payloadFields) { return sha256(digestString(payloadFields)); }

const HINTS = {
  permission_denied: { ko: '달력 권한이 없습니다. 설정에서 허용한 뒤 다시 시도해 주세요. 아무것도 전송되지 않았습니다.', en: 'Calendar permission was denied. Allow it in settings and try again. Nothing was sent.' },
  network: { ko: '연결되지 않았습니다. 아무것도 전송되지 않았습니다. 다시 시도해 주세요.', en: 'No connection. Nothing was sent. Please try again.' },
  timeout: { ko: '응답이 없어 결과를 확인하지 못했습니다. 달력을 직접 확인해 주세요. 다시 시도하기 전에 먼저 결과 확인을 눌러 주세요.', en: "We didn't get an answer, so we can't tell whether it worked. Please check your calendar, and tap Check result before trying again." },
  api_500: { ko: '서버 오류로 결과를 확인하지 못했습니다. 달력을 직접 확인해 주세요.', en: "The server had a problem, so we can't tell whether it worked. Please check your calendar." },
  lost_response: { ko: '요청은 보냈지만 답을 받지 못했습니다. 달력을 직접 확인해 주세요. 다시 시도하기 전에 먼저 결과 확인을 눌러 주세요.', en: 'The request went out, but no answer came back. Please check your calendar, and tap Check result before trying again.' },
  readback_mismatch: { ko: '확인해 보니 요청한 내용과 다릅니다. 이 결과를 사용하지 마세요.', en: "What was stored doesn't match what you asked for. Please don't rely on it." },
  missing_on_readback: { ko: '확인해 보니 항목을 찾을 수 없습니다.', en: "We looked again and couldn't find this entry." },
  stale_preview: { ko: '내용이 바뀌었습니다. 다시 확인해 주세요.', en: 'Something changed since you last looked. Please review the details again.' },
  duplicate: { ko: '같은 사람, 같은 시간의 일정이 이미 있습니다.', en: 'You already have something with this person at this time.' },
  storage_error: { ko: '이 기기의 달력 파일에 쓰지 못했습니다. 아무것도 저장되지 않았습니다. 다시 시도해 주세요.', en: "EBYS couldn't write to the calendar file on this device. Nothing was changed. Please try again." },
  calendar_corrupt: { ko: '달력 파일이 손상되어 건드리지 않았습니다. 도움이 필요합니다.', en: 'The calendar file on this device looks damaged, so EBYS left it alone. Please ask for help.' },
  invalid_event: { ko: '일정 내용이 올바르지 않아 저장하지 않았습니다.', en: "This entry wasn't valid, so nothing was changed." },
  readback_failed: { ko: '저장 후 다시 읽어 확인하지 못했습니다. 달력을 직접 확인해 주세요.', en: "EBYS couldn't read the entry back after writing it. Please check the calendar." },
  proposal_inactive: { ko: '이 항목은 취소되었거나 만료되어 아무것도 실행하지 않았습니다. 계속 원하시면 처음부터 다시 해 주세요.', en: 'This was cancelled or has expired, so nothing was done. Please start again if you still want it.' },
  digest_required: { ko: '확인하기 전에 내용을 먼저 살펴봐 주세요.', en: 'Please look over the details before you confirm.' },
  invalid_intent: { ko: '요청에 문제가 있어 아무것도 실행하지 않았습니다.', en: 'Something was wrong with this request, so nothing was done.' },
  not_found: { ko: '해당 항목을 찾을 수 없습니다.', en: "We couldn't find that item." },
  forbidden_output: { ko: '안전하지 않은 내용이 있어 중단했습니다.', en: "EBYS stopped because the text contained a link it won't use." },
};

const err = (code, message, o = {}) => ({
  ok: false,
  error: { code, message, retryable: !!o.retryable, phase: o.phase ?? 'pre_send', userHint: HINTS[code], ...(o.extra ?? {}) },
});

const PROMPTS = {
  when: { ko: '정확한 날짜와 시간을 알려 주세요. 오전인지 오후인지도 알려 주세요.', en: 'What date and time should it be? Please include AM or PM.' },
  when_date_only: { ko: '날짜는 알겠는데 시간을 모르겠어요. 몇 시로 할까요? 오전인지 오후인지도 알려 주세요.', en: "I have the date but not the time. What time should it be, and is that AM or PM?" },
  when_ambiguous: { ko: '시간이 확실하지 않아요. 정확한 날짜와 시간(오전/오후 포함)을 알려 주세요.', en: "I'm not sure about the time yet. Please tell me the exact date and time, including AM or PM." },
  when_unknown: { ko: '언제인지 아직 모르겠어요. 날짜와 시간을 알려 주세요.', en: "I don't know when this is yet. What date and time should it be?" },
  title: { ko: '무엇에 대한 일정인지 알려 주세요.', en: 'What is this for?' },
  other: { ko: '입력한 내용을 다시 확인해 주세요.', en: 'Please check the details and try again.' },
};

/** Validate and normalise an ActionIntent without guessing. */
function normalize(intent) {
  const missing = [];
  const reasons = [];
  if (!intent || typeof intent !== 'object') return { bad: true, reasons: ['intent_not_object'], missing: ['intent'] };
  if (typeof intent.intentId !== 'string' || !intent.intentId) { missing.push('intentId'); reasons.push('intentId_required'); }
  if (!Number.isInteger(intent.revision) || intent.revision < 1) { missing.push('revision'); reasons.push('revision_required'); }
  if (!['appointment', 'reminder'].includes(intent.kind)) { missing.push('kind'); reasons.push('kind_invalid'); }
  const title = cleanText(intent.title, 120); // 120 = the EBYS calendar store limit, so readback never fails on truncation
  if (!title) { missing.push('title'); reasons.push('title_required'); }

  const prec = intent.when?.precision;
  const startMs = prec === 'exact' ? parseExactIso(intent.when?.startIso) : null;
  if (startMs === null) {
    missing.push('when');
    reasons.push(prec === 'exact' ? 'startIso_invalid' : `when_${prec ?? 'unknown'}`);
  }

  const rawOffsets = Array.isArray(intent.reminderOffsetsMin) ? intent.reminderOffsetsMin : [];
  if (!rawOffsets.every((n) => Number.isInteger(n) && n >= 1 && n <= 43200)) { missing.push('reminders'); reasons.push('reminder_offsets_invalid'); }
  const reminders = [...new Set(rawOffsets)].sort((a, b) => b - a);

  const defDur = intent.kind === 'reminder' ? 15 : 60;
  let durationMin = defDur;
  if (intent.when?.durationMin !== undefined) {
    if (Number.isInteger(intent.when.durationMin) && intent.when.durationMin >= 1 && intent.when.durationMin <= 1440) durationMin = intent.when.durationMin;
    else { missing.push('duration'); reasons.push('duration_invalid'); }
  }

  if (missing.length) {
    const precKey = ['date_only', 'ambiguous', 'unknown'].includes(prec) ? `when_${prec}` : 'when';
    const key = missing.includes('when') ? precKey : missing.includes('title') ? 'title' : 'other';
    return { missing, reasons, prompt: PROMPTS[key] };
  }
  const who = cleanText(intent.person?.displayName, 100) || null;
  const where = cleanText(intent.place, 120) || null;
  return {
    n: { intentId: intent.intentId, revision: intent.revision, kind: intent.kind, title, who, startMs, durationMin, where, reminders,
      uncertainty: Array.isArray(intent.uncertainty) ? intent.uncertainty.map((u) => cleanText(u, 80)) : [],
      tz: typeof intent.when?.tz === 'string' ? intent.when.tz : undefined,
      speakerConfidence: intent.person?.speakerConfidence ?? 'unknown', sessionId: intent.sessionId, proposalState: intent.proposalState },
  };
}

const sameView = (a, b) => {
  const diffs = [];
  if (!a || !b) return ['missing'];
  if (a.title !== b.title) diffs.push('title');
  if (parseExactIso(a.startsAt) !== parseExactIso(b.startsAt)) diffs.push('startsAt');
  if ((a.where ?? null) !== (b.where ?? null)) diffs.push('where');
  if ((a.who ?? null) !== (b.who ?? null)) diffs.push('who');
  if (JSON.stringify(a.reminders ?? []) !== JSON.stringify(b.reminders ?? [])) diffs.push('reminders');
  return diffs;
};

/**
 * @param {{ now?: () => (string|number|Date), mode?: 'simulated'|'real', adapters?: { calendar?: any, notification?: any },
 *   fault?: string|{type:string,times?:number}|null, timeoutMs?: number, slowMs?: number }} [opts]
 */
export function createActionService({ now = demoNow, mode = 'simulated', real = 'local', calendarFile, adapters = {}, fault = null, timeoutMs = 10000, slowMs = 800 } = {}) {
  if (mode !== 'simulated' && mode !== 'real') throw new TypeError(`mode must be 'simulated' or 'real', got ${mode}`);
  if (real !== 'local' && real !== 'ics') throw new TypeError(`real must be 'local' or 'ics', got ${real}`);
  const calendar = adapters.calendar ?? (mode === 'simulated' ? createSimulatedCalendarAdapter()
    : real === 'ics' ? createIcsHandoffAdapter() : createLocalCalendarAdapter(calendarFile ? { file: calendarFile } : {}));
  const notifier = adapters.notification ?? createNotificationPreview();
  const cal = calendar.describe();
  if (cal.mode !== mode) throw new TypeError(`calendar adapter ${cal.id} has mode ${cal.mode} but service mode is ${mode}; refusing to mislabel`);

  const nowMs = () => { const v = now(); const ms = v instanceof Date ? v.getTime() : typeof v === 'number' ? v : Date.parse(v); if (Number.isNaN(ms)) throw new TypeError('now() returned an invalid time'); return ms; };
  const stamp = () => toKstIso(nowMs());

  /** @type {Map<string, any>} opKey -> record */ const records = new Map();
  /** @type {Map<string, any>} recordId -> operation data (not exposed) */ const ops = new Map();
  /** @type {Map<string, any>} recordId -> artifact */ const artifacts = new Map();
  /** @type {Map<string, Promise<any>>} */ const inflight = new Map();
  /** @type {Map<string, number>} */ const latestRev = new Map();

  let faultState = null;
  const setFault = (f) => {
    if (f === null || f === undefined || f === '') { faultState = null; return; }
    const type = typeof f === 'string' ? f : f.type;
    if (!FAULTS.includes(type)) throw new TypeError(`unknown fault ${type}; allowed: ${FAULTS.join(', ')}`);
    faultState = { type, times: typeof f === 'object' && f.times ? f.times : Infinity };
  };
  setFault(fault);
  const takeFault = () => {
    if (!faultState) return null;
    const t = faultState.type;
    faultState.times -= 1;
    if (faultState.times <= 0) faultState = null;
    return t;
  };

  const uidFor = (intentId) => `sj-${sha256(String(intentId)).slice(0, 24)}@ebys.local`;
  const clone = (o) => structuredClone(o);
  const touch = (rec, status) => { rec.status = status; rec.timestamps.updatedAt = stamp(); rec.history.push({ at: rec.timestamps.updatedAt, status }); };

  function buildPreview(n) {
    const cd = calendar.describe();
    const payload = {
      intentId: n.intentId, revision: n.revision, kind: n.kind, title: n.title, who: n.who, startEpoch: n.startMs, durationMin: n.durationMin,
      where: n.where, reminders: n.reminders, adapterId: cd.id, mode: cd.mode, tz: TZ,
    };
    const uid = uidFor(n.intentId);
    const fields = {
      kind: n.kind, title: n.title, who: n.who, startsAt: toKstIso(n.startMs), endsAt: toKstIso(n.startMs + n.durationMin * 60000),
      durationMin: n.durationMin, where: n.where, reminders: n.reminders, tz: TZ,
    };
    const dt = displayDateTime(n.startMs);
    const warnings = [];
    if (n.startMs < nowMs()) warnings.push({ code: 'in_past', message: { ko: '이 시간은 이미 지났습니다.', en: 'This time is already in the past.' } });
    if (!n.where) warnings.push({ code: 'place_unknown', message: { ko: '장소가 정해지지 않았습니다.', en: 'No place has been set.' } });
    if (!n.who) warnings.push({ code: 'person_unknown', message: { ko: '상대가 정해지지 않았습니다.', en: 'No person has been set.' } });
    if (n.tz && n.tz !== TZ) {
      // never silently reinterpret: the instant is kept, the zone difference is shown
      warnings.push({ code: 'timezone_differs', message: {
        ko: `선택하신 시간대는 ${n.tz}이지만 EBYS 달력은 서울 시간(UTC+9)으로 저장합니다. ${displayDateTime(n.startMs).ko}로 저장됩니다.`,
        en: `Your time zone is set to ${n.tz}, but EBYS calendar entries are kept in Seoul time (UTC+9). This will be stored as ${displayDateTime(n.startMs).en}.` } });
    }
    if (cd.id === 'calendar.ics-handoff') {
      warnings.push({ code: 'ics_local_timezone', message: {
        ko: '휴대폰 달력은 이 시간을 휴대폰의 시간대로 보여 줍니다. 여기 표시된 시간은 서울 시간(UTC+9)입니다.',
        en: "Your phone's calendar will show this in the phone's own time zone. The time shown here is Seoul time (UTC+9)." } });
    }
    const payloadPreview = calendar.build?.(
      { ...fields, startMs: n.startMs, reminders: n.reminders }, { uid, sequence: n.revision - 1, nowMs: nowMs() }) ?? null;
    const notifications = notifier.build({ title: n.title, who: n.who, startMs: n.startMs, reminders: n.reminders, nowMs: nowMs() });
    const preview = {
      needs_clarification: false,
      intentId: n.intentId, revision: n.revision, kind: n.kind, adapterId: cd.id, mode: cd.mode,
      previewDigest: computePreviewDigest(payload),
      fields,
      display: {
        when: dt,
        whenParts: displayParts(n.startMs),
        where: n.where ? { ko: n.where, en: n.where } : { ko: '장소 미정', en: 'Place not set' },
        who: n.who ? { ko: n.who, en: n.who } : { ko: '상대 미정', en: 'Person not set' },
        reminders: n.reminders.map(displayOffset),
      },
      summary: {
        ko: `${n.title}${n.who ? ` (${n.who}님)` : ''} - ${dt.ko}`,
        en: `${n.title}${n.who ? ` with ${n.who}` : ''} - ${dt.en}`,
      },
      modeLabel: cd.mode === 'simulated'
        ? { ko: '시뮬레이션: 휴대폰에는 저장되지 않습니다', en: 'Simulation only: nothing will be saved to your phone or calendar' }
        : cd.id === 'calendar.local'
          ? { ko: '이 기기의 EBYS 달력에 저장합니다 (휴대폰 달력 아님)', en: 'Saved to the EBYS calendar on this device (not your phone calendar)' }
          : { ko: '달력 파일 전달: 직접 저장해야 합니다', en: 'Calendar file: you open it and save it yourself' },
      uncertainty: n.uncertainty,
      warnings,
      notifications,
      payload: payloadPreview,
    };
    return { preview, uid, payload };
  }

  function duplicateOf(n, ignoreOpKey) {
    const key = (x) => `${x.kind}|${(x.who ?? x.title).toLowerCase()}|${x.startMs}`;
    for (const rec of records.values()) {
      if (rec.opKey === ignoreOpKey || rec.intentId === n.intentId) continue;
      if (!['confirmed', 'executing', 'handed_off', 'completed', 'unknown_outcome'].includes(rec.status)) continue;
      const o = ops.get(rec.recordId)?.n;
      if (o && key(o) === key(n)) return rec.recordId;
    }
    return null;
  }

  function preview(intent) {
    const v = normalize(intent);
    if (v.bad || v.missing) {
      return { needs_clarification: true, missing: v.missing, reasons: v.reasons, prompt: v.prompt ?? PROMPTS.other };
    }
    if (Number.isInteger(v.n.revision)) latestRev.set(v.n.intentId, Math.max(latestRev.get(v.n.intentId) ?? 0, v.n.revision));
    const { preview: p } = buildPreview(v.n);
    const dup = duplicateOf(v.n);
    if (dup) p.duplicateOf = dup;
    return p;
  }

  async function withTimeout(promise) {
    let timer;
    const t = new Promise((_, rej) => { timer = setTimeout(() => rej(new AdapterError('timeout', 'no response before timeout', { phase: 'post_send', status: 'unknown_outcome' })), timeoutMs); });
    try { return await Promise.race([promise, t]); } finally { clearTimeout(timer); }
  }

  async function runAdapter(op, f) {
    if (f === 'permission_denied') throw new AdapterError('permission_denied', 'calendar permission denied (test fault)', { phase: 'pre_send', retryable: true, status: 'permission_denied' });
    if (f === 'network') throw new AdapterError('network', 'network unreachable (test fault)', { phase: 'pre_send', retryable: true, status: 'failed' });
    if (f === 'timeout') return new Promise(() => {}); // request "sent", nothing ever comes back; withTimeout fires
    const res = await calendar.execute({ op, fault: f, slowMs, nowMs: nowMs() });
    if (f === 'api_500') throw new AdapterError('api_500', 'server error 500 (test fault)', { phase: 'post_send', status: 'unknown_outcome' });
    if (f === 'lost_response') throw new AdapterError('lost_response', 'response lost after send (test fault)', { phase: 'post_send', status: 'unknown_outcome' });
    return res;
  }

  function applyReadback(rec, op, view) {
    rec.readback = view ? { title: view.title, startsAt: view.startsAt, where: view.where ?? undefined, who: view.who ?? undefined, reminders: view.reminders } : undefined;
  }

  function finish(rec) { rec.readbackText = readbackText(rec); }

  async function execute(rec, op) {
    rec.attempts += 1;
    const f = takeFault();
    if (f) rec.testFault = f;
    touch(rec, 'executing');
    rec.error = undefined;
    try {
      const res = await withTimeout(runAdapter(op, f));
      if (res.artifact) artifacts.set(rec.recordId, res.artifact);
      let view;
      try { view = await calendar.read({ op, artifact: res.artifact ?? null }); } catch (re) {
        // the write may have happened but we cannot see it: never report success or "nothing saved"
        throw new AdapterError('readback_failed', `readback failed after write: ${re?.code ?? re?.message}`, { phase: 'post_send', status: 'unknown_outcome' });
      }
      applyReadback(rec, op, view);
      const diffs = sameView(view, rec.preview.fields);
      if (diffs.length) {
        artifacts.delete(rec.recordId);
        let rolledBack = false;
        try { if (res.undo) { await res.undo(); rolledBack = true; } } catch { rolledBack = false; }
        rec.verifyLevel = 'none'; // nothing trustworthy was handed off or written
        rec.error = { code: 'readback_mismatch', message: `readback differs: ${diffs.join(', ')}`, retryable: false, phase: 'post_send', mismatch: diffs, rolledBack, userHint: HINTS.readback_mismatch };
        touch(rec, 'verify_mismatch');
      } else if (artifacts.has(rec.recordId)) {
        const bad = findForbiddenOutput(artifacts.get(rec.recordId).content);
        if (bad) {
          artifacts.delete(rec.recordId);
          rec.error = { code: 'forbidden_output', message: bad, retryable: false, phase: 'pre_send', userHint: HINTS.forbidden_output };
          touch(rec, 'failed');
        } else {
          rec.verifyLevel = 'handoff';
          rec.artifact = { filename: res.artifact.filename, mime: res.artifact.mime, bytes: res.artifact.content.length };
          touch(rec, 'handed_off'); // never 'completed': we cannot see the phone's calendar
        }
      } else {
        // simulated store: 'none'. Real local store: the file was re-read and matched => the adapter's max level ('api_readback').
        rec.verifyLevel = cal.mode === 'simulated' ? 'none' : cal.maxVerifyLevel;
        touch(rec, 'completed');
      }
    } catch (e) {
      const ae = e instanceof AdapterError ? e : new AdapterError('adapter_exception', String(e?.message ?? e), { phase: 'post_send', status: 'unknown_outcome' });
      rec.verifyLevel = 'none';
      rec.error = { code: ae.code, message: ae.message, retryable: ae.phase === 'pre_send' && ae.retryable, phase: ae.phase, userHint: HINTS[ae.code] ?? HINTS.timeout };
      touch(rec, ae.phase === 'post_send' ? 'unknown_outcome' : ae.status);
    }
    finish(rec);
    return rec;
  }

  async function confirm({ intent, previewDigest, allowDuplicate = false } = {}) {
    const v = normalize(intent);
    if (v.bad) return err('invalid_intent', 'intent missing or not an object');
    if (v.missing) return err('needs_clarification', `cannot act: ${v.reasons.join(', ')}`, { extra: { missing: v.missing, prompt: v.prompt, userHint: v.prompt } });
    const n = v.n;
    if (n.proposalState && !['proposed', 'user_confirmed'].includes(n.proposalState)) {
      return err('proposal_inactive', `proposal state is ${n.proposalState}`, { extra: { proposalState: n.proposalState } });
    }
    if (n.revision < (latestRev.get(n.intentId) ?? 0)) return err('stale_preview', `revision ${n.revision} is older than ${latestRev.get(n.intentId)}`);
    if (typeof previewDigest !== 'string' || !previewDigest) return err('digest_required', 'previewDigest is required');
    const built = buildPreview(n);
    if (built.preview.previewDigest !== previewDigest) return err('stale_preview', 'the details changed after the preview was shown');
    latestRev.set(n.intentId, Math.max(latestRev.get(n.intentId) ?? 0, n.revision));

    const opKey = `${n.intentId}:${n.revision}`;
    const existing = records.get(opKey);
    if (existing) {
      if (inflight.has(opKey)) return clone(await inflight.get(opKey));
      const retry = ['failed', 'permission_denied'].includes(existing.status) && existing.error?.phase === 'pre_send' && existing.error?.retryable;
      if (!retry) return { ...clone(existing), deduplicated: true };
      const op = ops.get(existing.recordId);
      const p = execute(existing, op).then((r) => clone(r)).finally(() => inflight.delete(opKey));
      inflight.set(opKey, p);
      return clone(await p);
    }
    if (!allowDuplicate) {
      const dup = duplicateOf(n, opKey);
      if (dup) return err('duplicate', `same person and time as record ${dup}`, { extra: { duplicateOf: dup } });
    }
    const recordId = `act_${sha256(opKey).slice(0, 12)}`;
    const t = stamp();
    const rec = {
      recordId, intentId: n.intentId, revision: n.revision, opKey,
      adapterId: built.preview.adapterId, mode: built.preview.mode,
      status: 'confirmed', verifyLevel: 'none', preview: built.preview, attempts: 0, calendarLabel: cal.calendarLabel,
      timestamps: { createdAt: t, confirmedAt: t, updatedAt: t }, history: [{ at: t, status: 'confirmed' }],
    };
    const op = { uid: built.uid, sequence: n.revision - 1, fields: { ...built.preview.fields, startMs: n.startMs }, n };
    // supersede earlier revisions of the same appointment
    for (const r of records.values()) if (r.intentId === n.intentId && r.revision < n.revision) r.supersededByRevision = n.revision;
    records.set(opKey, rec);
    ops.set(recordId, { ...op, n });
    const p = execute(rec, op).then((r) => clone(r)).finally(() => inflight.delete(opKey));
    inflight.set(opKey, p);
    return clone(await p);
  }

  async function readback(recordId) {
    const rec = [...records.values()].find((r) => r.recordId === recordId);
    if (!rec) return err('not_found', `no record ${recordId}`);
    if (inflight.has(rec.opKey)) return clone(await inflight.get(rec.opKey));
    const op = ops.get(recordId);
    let view = null;
    try { view = await calendar.read({ op, artifact: artifacts.get(recordId) ?? null }); } catch { view = null; }
    if (rec.status === 'unknown_outcome') {
      if (cal.canReconcile) {
        if (view) {
          applyReadback(rec, op, view);
          const diffs = sameView(view, rec.preview.fields);
          if (diffs.length) { rec.error = { code: 'readback_mismatch', message: `readback differs: ${diffs.join(', ')}`, retryable: false, phase: 'post_send', mismatch: diffs, userHint: HINTS.readback_mismatch }; touch(rec, 'verify_mismatch'); }
          else { rec.error = undefined; rec.verifyLevel = cal.mode === 'simulated' ? 'none' : cal.maxVerifyLevel; touch(rec, 'completed'); }
        } else {
          // verified absent: nothing exists, so a retry cannot duplicate
          rec.error = { code: 'not_found_after_unknown', message: 'reconciled: nothing was written', retryable: true, phase: 'pre_send', reconciled: true, userHint: { ko: '확인 결과 아무것도 저장되지 않았습니다. 다시 시도할 수 있습니다.', en: 'We checked, and nothing was written. You can try again.' } };
          touch(rec, 'failed');
        }
      } else {
        rec.reconcile = { attempted: true, result: 'cannot_verify', at: stamp() };
      }
    } else if (rec.status === 'completed' && cal.canReconcile) {
      if (!view) { rec.error = { code: 'missing_on_readback', message: 'entry not found on re-check', retryable: false, phase: 'post_send', userHint: HINTS.missing_on_readback }; touch(rec, 'verify_mismatch'); }
      else {
        applyReadback(rec, op, view);
        const diffs = sameView(view, rec.preview.fields);
        if (diffs.length) { // the stored entry changed behind our back: stop calling it done
          rec.error = { code: 'readback_mismatch', message: `readback differs: ${diffs.join(', ')}`, retryable: false, phase: 'post_send', mismatch: diffs, userHint: HINTS.readback_mismatch };
          touch(rec, 'verify_mismatch');
        }
      }
    } else if (view) {
      applyReadback(rec, op, view);
    }
    finish(rec);
    return clone(rec);
  }

  async function cancel(recordId) {
    const rec = [...records.values()].find((r) => r.recordId === recordId);
    if (!rec) return err('not_found', `no record ${recordId}`);
    if (['cancelled', 'expired'].includes(rec.status)) return clone(rec);
    const op = ops.get(recordId);
    const wasPreSend = rec.status === 'confirmed' || (['failed', 'permission_denied'].includes(rec.status) && rec.error?.phase === 'pre_send');
    if (cal.canReconcile) {
      let gone = false;
      try { await calendar.remove({ op }); gone = !(await calendar.read({ op, artifact: null })); } catch { gone = false; }
      if (!gone) {
        // the entry may still exist (and still fire reminders): do NOT claim it was cancelled
        rec.error = { code: 'cancel_unconfirmed', message: 'removal could not be verified', retryable: true, phase: 'post_send',
          userHint: { ko: '삭제를 확인하지 못했습니다. 달력을 확인하고 다시 시도해 주세요.', en: "We couldn't confirm the removal. Please check the calendar and try again." } };
        finish(rec);
        return clone(rec);
      }
      rec.cancelNote = cal.mode === 'simulated'
        ? { ko: '시뮬레이션 달력에서 삭제했고 확인했습니다.', en: 'Removed from the simulated calendar and checked.' }
        : { ko: `${cal.calendarLabel.ko}에서 삭제하고 다시 읽어 확인했습니다. 예정된 알림도 취소되었습니다.`, en: `Removed from ${cal.calendarLabel.en} and read back to check. Its reminders are cancelled too.` };
    } else {
      rec.cancelNote = wasPreSend
        ? { ko: '취소되었습니다. 아무것도 전송되지 않았습니다.', en: 'Cancelled. Nothing was sent.' }
        : { ko: '취소했지만 이미 달력에 저장했는지는 확인할 수 없습니다. 달력을 직접 확인해 주세요.', en: "Cancelled, but we can't tell whether you already saved it. Please check your calendar." };
    }
    artifacts.delete(recordId);
    touch(rec, 'cancelled');
    finish(rec);
    return clone(rec);
  }

  function getArtifact(recordId) {
    const rec = [...records.values()].find((r) => r.recordId === recordId);
    const a = artifacts.get(recordId);
    if (!rec || !a || rec.status !== 'handed_off') return null;
    return clone(a);
  }

  function list() { return [...records.values()].map(clone); }

  /** Participates in DeletionReceipt as store 'action_ledger'. Scope: one session, or everything when no sessionId. */
  function purge({ sessionId } = {}) {
    const victims = [...records.values()].filter((r) => (sessionId === undefined ? true : ops.get(r.recordId)?.n?.sessionId === sessionId));
    const hadExport = victims.some((r) => r.artifact);
    for (const r of victims) {
      // adapter remove() bodies are synchronous; a rejection is swallowed here and the calendar-level purge below reports what is left
      try { calendar.remove?.({ op: ops.get(r.recordId) })?.catch?.(() => {}); } catch { /* see above */ }
      records.delete(r.opKey); ops.delete(r.recordId); artifacts.delete(r.recordId); inflight.delete(r.opKey);
      latestRev.delete(r.intentId);
    }
    const remaining = [...records.values()].filter((r) => (sessionId === undefined ? true : ops.get(r.recordId)?.n?.sessionId === sessionId));
    const unattributed = sessionId === undefined ? 0 : [...records.values()].filter((r) => ops.get(r.recordId)?.n?.sessionId === undefined).length;
    const verified = remaining.length === 0;
    const related = [
      { name: 'exported_file', status: hadExport ? 'not_verified' : 'not_applicable',
        detail: hadExport ? 'a calendar file was handed to the phone/OS; it is outside this app and cannot be deleted or checked from here' : 'no calendar file was produced' },
      { name: 'external_calendar', status: 'not_applicable', detail: 'no phone calendar or cloud account is written by this layer (EBYS-local file, file handoff or simulated only)' },
    ];
    if (calendar.purge) {
      // covers entries that exist in the file but not in this process's ledger (e.g. after a server restart)
      const p = calendar.purge({ sessionId });
      related.push(
        { name: 'local_calendar', status: p.verified ? 'verified_deleted' : 'not_verified',
          detail: p.verified ? `removed ${p.removedEvents} event(s), ${p.removedTasks} task(s); re-read the file: ${p.remaining} remaining in scope` : `could not verify (${p.error ?? 'entries remain'})` },
        { name: 'notification_queue', status: p.verified ? 'verified_deleted' : 'not_verified',
          detail: p.verified ? `removed ${p.removedNotifications} queued reminder(s); re-read the file: none remaining in scope` : 'could not verify' });
    }
    return {
      name: 'action_ledger',
      status: verified ? 'verified_deleted' : 'not_deleted',
      detail: `removed ${victims.length} record(s); ${remaining.length} remaining in scope${unattributed ? `; ${unattributed} record(s) without a sessionId were not in scope` : ''}`,
      related,
    };
  }

  function describe() {
    const c = calendar.describe();
    const nt = notifier.describe();
    return {
      data: 'synthetic',
      defaultLang: DEFAULT_LANG, // every {ko,en} copy object is English-first; Korean is optional
      timezone: { iana: TZ, label: { en: 'Seoul time', ko: '서울 시간' }, utcOffset: '+09:00',
        note: { en: 'EBYS stores calendar times in Seoul time (UTC+9) and always shows the zone next to the time.', ko: 'EBYS는 달력 시간을 서울 시간(UTC+9)으로 저장하고 시간 옆에 항상 표시합니다.' } },
      calendar: mode === 'simulated'
        ? { kind: 'simulated', name: 'Demo Calendar (in this app only, simulated)', permission: 'not_required' }
        : c.id === 'calendar.local'
          ? { kind: 'ebys_local', name: 'EBYS calendar on this device (local file; not the phone calendar)', permission: 'file_write' }
          : { kind: 'ics_handoff', name: 'Calendar file (.ics) handoff; saving on the phone cannot be verified', permission: 'user_action_required' },
      notifications: c.id === 'calendar.local'
        ? { kind: 'in_app_poll', permission: 'not_applicable', note: 'reminders appear inside EBYS when polled; not an OS or phone notification' }
        : { kind: 'preview', permission: 'not_applicable' },
      micCapture: 'unavailable',
      speechInput: 'unavailable',
      version: VERSION,
      mode,
      adapters: [c, nt],
      faultInjection: faultState ? { active: faultState.type, label: 'TEST FAULT INJECTION' } : null,
      forbidden: 'no tel/sms/mailto/emergency actions exist in this layer',
    };
  }

  /**
   * Run the reminder sweep (source rules: see calendar-local.mjs) and return reminders to show in the UI.
   * Poll with `since` = lastN of the previous call. Only the EBYS-local calendar produces reminders; other adapters return none.
   * @param {string|number|Date} [at] defaults to the injected clock (QA/demo may pass a later time to "advance" the day)
   */
  function dueNotifications(at, { since = 0 } = {}) {
    if (!calendar.sweep) return { ok: true, source: 'none', now: stamp(), notifications: [], lastN: 0 };
    const t = at === undefined ? nowMs() : (at instanceof Date ? at.getTime() : typeof at === 'number' ? at : Date.parse(at));
    if (Number.isNaN(t)) return { ok: false, error: { code: 'bad_time', message: 'invalid now', retryable: false }, notifications: [], lastN: since };
    try {
      calendar.sweep(t);
      const byUid = new Map();
      for (const [recordId, o] of ops) byUid.set(o.uid, recordId);
      const notifications = calendar.notificationsSince(since).map((nt) => ({ ...nt, recordId: byUid.get(nt.uid) ?? null }));
      return { ok: true, source: 'calendar.local', now: toKstIso(t), notifications, lastN: calendar.lastNotificationN() };
    } catch (e) {
      return { ok: false, error: { code: e?.code ?? 'sweep_failed', message: String(e?.message ?? e), retryable: true }, notifications: [], lastN: since };
    }
  }

  return { preview, confirm, readback, cancel, list, purge, describe, getArtifact, setFault, dueNotifications, _adapters: { calendar, notifier } };
}

export { ACTION_STATUS, VERIFY_LEVEL };
