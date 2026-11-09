import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createActionService, computePreviewDigest, FAULTS } from './action-service.mjs';
import { computePreviewDigestAsync, digestPayload } from './digest.mjs';
import { intentFromProposal } from './intent.mjs';
import { displayState } from '../contracts/contracts.js';

const NOW = '2026-11-09T10:30:00+09:00';
const now = () => NOW;
const mkIntent = (o = {}) => ({
  intentId: 'prop_1', revision: 1, kind: 'appointment', title: 'Lunch', person: { displayName: 'Minsu', speakerConfidence: 'confirmed' },
  when: { precision: 'exact', startIso: '2026-11-13T15:00:00+09:00', tz: 'Asia/Seoul' }, place: 'Han River Cafe',
  reminderOffsetsMin: [60, 1440], sourceRefs: [], uncertainty: [], sessionId: 's1', ...o,
});
const tmpFile = () => join(mkdtempSync(join(tmpdir(), 'ebys-actions-')), 'calendar.json');
// real + no explicit adapter => the EBYS-local calendar, always in a throwaway temp directory in tests
const svc = (o = {}) => createActionService({ now, timeoutMs: 40, slowMs: 5, ...(o.mode === 'real' && o.real !== 'ics' && !o.calendarFile ? { calendarFile: tmpFile() } : {}), ...o });
const SUCCESS_WORDS = /\b(saved|done|completed|success(?:ful)?|added to your calendar)\b/i;
const KO_SUCCESS = /(저장되었|저장했|완료)/;

async function confirmed(service, intent = mkIntent(), extra = {}) {
  const p = service.preview(intent);
  return service.confirm({ intent, previewDigest: p.previewDigest, ...extra });
}

test('preview: deterministic, no ledger effect, full human content', () => {
  const s = svc();
  const a = s.preview(mkIntent());
  const b = s.preview(mkIntent());
  assert.deepEqual(a, b);
  assert.equal(s.list().length, 0);
  assert.match(a.previewDigest, /^[0-9a-f]{64}$/);
  assert.equal(a.fields.startsAt, '2026-11-13T15:00:00+09:00');
  assert.deepEqual(a.fields.reminders, [1440, 60]);
  assert.equal(a.notifications.length, 2);
  assert.ok(a.notifications.every((n) => n.mode === 'simulated' && n.badge.en === 'PREVIEW'));
  assert.match(a.modeLabel.en, /Simulation only/);
  assert.match(a.summary.en, /Lunch with Minsu/);
});

test('digest covers every consequential field, including reminders, adapter and mode', () => {
  const s = svc();
  const d0 = s.preview(mkIntent()).previewDigest;
  for (const patch of [
    { title: 'Dinner' }, { person: { displayName: 'Jisoo', speakerConfidence: 'confirmed' } }, { place: 'Home' },
    { reminderOffsetsMin: [60] }, { when: { precision: 'exact', startIso: '2026-11-13T16:00:00+09:00', tz: 'Asia/Seoul' } },
    { when: { precision: 'exact', startIso: '2026-11-13T15:00:00+09:00', tz: 'Asia/Seoul', durationMin: 90 } }, { revision: 2 }, { intentId: 'other' }, { kind: 'reminder' },
  ]) assert.notEqual(svc().preview(mkIntent(patch)).previewDigest, d0, JSON.stringify(patch));
  assert.notEqual(svc({ mode: 'real', real: 'ics' }).preview(mkIntent()).previewDigest, d0, 'adapter+mode are in the digest');
  // same instant spelled differently => same digest; reminder order irrelevant
  assert.equal(svc().preview(mkIntent({ when: { precision: 'exact', startIso: '2026-11-13T06:00:00Z', tz: 'Asia/Seoul' }, reminderOffsetsMin: [1440, 60, 60] })).previewDigest, d0);
});

test('digest: browser-safe async variant equals the server digest', async () => {
  const p = { intentId: 'a', revision: 1, kind: 'appointment', title: 'T', who: null, startEpoch: 1794549600000, durationMin: 60, where: null, reminders: [60], adapterId: 'calendar.simulated', mode: 'simulated', tz: 'Asia/Seoul' };
  assert.equal(await computePreviewDigestAsync(p), computePreviewDigest(p));
  assert.ok(Object.keys(digestPayload(p)).includes('reminders'));
});

test('needs_clarification: ambiguous/date_only/unknown never get a preview or a guessed time', async () => {
  const s = svc();
  for (const precision of ['ambiguous', 'date_only', 'unknown']) {
    const intent = mkIntent({ when: { precision, tz: 'Asia/Seoul' } });
    const p = s.preview(intent);
    assert.equal(p.needs_clarification, true, precision);
    assert.ok(p.missing.includes('when'));
    assert.ok(p.prompt.ko && p.prompt.en);
    assert.equal(p.previewDigest, undefined);
    const c = await s.confirm({ intent, previewDigest: 'x' });
    assert.equal(c.ok, false);
    assert.equal(c.error.code, 'needs_clarification');
  }
  // 'exact' but unparseable / impossible date is also refused
  assert.equal(svc().preview(mkIntent({ when: { precision: 'exact', startIso: '2026-02-31T10:00:00+09:00', tz: 'Asia/Seoul' } })).needs_clarification, true);
  assert.equal(svc().preview(mkIntent({ title: '  ' })).needs_clarification, true);
  assert.equal(svc().preview(mkIntent({ reminderOffsetsMin: [-5] })).needs_clarification, true);
  assert.equal(s.list().length, 0);
});

test('simulated adapter: completed + simulated + verifyLevel none, never external', async () => {
  const s = svc();
  const r = await confirmed(s);
  assert.equal(r.status, 'completed');
  assert.equal(r.mode, 'simulated');
  assert.equal(r.verifyLevel, 'none');
  assert.equal(r.adapterId, 'calendar.simulated');
  assert.equal(displayState(r), 'simulated_completed');
  assert.match(r.readbackText.en, /^This is a simulation\. Nothing was saved/);
  assert.match(r.readbackText.en, /Minsu/);
  assert.match(r.readbackText.en, /13 Nov 2026, 3:00 PM/);
  assert.match(r.readbackText.en, /Appointment: Lunch/);
  assert.match(r.readbackText.ko, /시뮬레이션/);
  assert.equal(r.readback.startsAt, '2026-11-13T15:00:00+09:00');
  assert.equal(s.getArtifact(r.recordId), null);
});

test('ics-handoff adapter: handed_off, never completed, artifact is a valid file', async () => {
  const s = svc({ mode: 'real', real: 'ics' });
  const r = await confirmed(s);
  assert.equal(r.status, 'handed_off');
  assert.equal(r.mode, 'real');
  assert.equal(r.verifyLevel, 'handoff');
  assert.equal(displayState(r), 'handed_off');
  assert.match(r.readbackText.en, /not added to your calendar yet/);
  assert.doesNotMatch(r.readbackText.en, /\b(saved|done|completed|success(?:ful)?)\b|(?<!Not )added to your calendar/i);
  assert.doesNotMatch(r.readbackText.ko, KO_SUCCESS);
  const a = s.getArtifact(r.recordId);
  assert.match(a.filename, /^ebys-202611131500\.ics$/);
  assert.match(a.content, /^BEGIN:VCALENDAR\r\n/);
  assert.match(a.content, /DTSTART:20261113T060000Z/);
  assert.match(a.content, /SEQUENCE:0/);
  assert.equal(r.artifact.filename, a.filename);
  assert.equal(s.describe().calendar.kind, 'ics_handoff');
});

test('idempotent confirm: repeat and concurrent confirms execute once and return the first record', async () => {
  const s = svc();
  const intent = mkIntent();
  const { previewDigest } = s.preview(intent);
  const [a, b, c] = await Promise.all([1, 2, 3].map(() => s.confirm({ intent, previewDigest })));
  assert.equal(a.recordId, b.recordId); assert.equal(b.recordId, c.recordId);
  const d = await s.confirm({ intent, previewDigest });
  assert.equal(d.recordId, a.recordId);
  assert.equal(d.deduplicated, true);
  assert.equal(s._adapters.calendar.stats.executions, 1);
  assert.equal(s.list().length, 1);
  assert.equal(s._adapters.calendar.size(), 1);
});

test('stale_preview: edited fields, newer revision, missing digest', async () => {
  const s = svc();
  const intent = mkIntent();
  const { previewDigest } = s.preview(intent);
  const edited = await s.confirm({ intent: mkIntent({ title: 'Dinner' }), previewDigest });
  assert.equal(edited.ok, false); assert.equal(edited.error.code, 'stale_preview');
  const reminderEdit = await s.confirm({ intent: mkIntent({ reminderOffsetsMin: [5] }), previewDigest });
  assert.equal(reminderEdit.error.code, 'stale_preview');
  const noDigest = await s.confirm({ intent });
  assert.equal(noDigest.error.code, 'digest_required');
  // user edits to revision 2 (previewed), then a stale tab confirms revision 1
  s.preview(mkIntent({ revision: 2, title: 'Lunch (edited)' }));
  const old = await s.confirm({ intent, previewDigest });
  assert.equal(old.error.code, 'stale_preview');
  assert.equal(s.list().length, 0, 'rejections create no record and no side effect');
  assert.equal(s._adapters.calendar.stats.executions, 0);
});

test('cancelled / expired / needs_info proposals are refused', async () => {
  const s = svc();
  for (const proposalState of ['cancelled', 'expired', 'needs_info']) {
    const intent = mkIntent({ proposalState });
    const r = await s.confirm({ intent, previewDigest: s.preview(intent).previewDigest });
    assert.equal(r.ok, false); assert.equal(r.error.code, 'proposal_inactive');
  }
  const ok = mkIntent({ proposalState: 'user_confirmed' });
  assert.equal((await s.confirm({ intent: ok, previewDigest: s.preview(ok).previewDigest })).status, 'completed');
});

test('duplicate appointment: same person+time under another intent is blocked unless explicitly allowed', async () => {
  const s = svc();
  const first = await confirmed(s);
  const other = mkIntent({ intentId: 'prop_2' });
  assert.equal(s.preview(other).duplicateOf, first.recordId);
  const blocked = await confirmed(s, other);
  assert.equal(blocked.ok, false); assert.equal(blocked.error.code, 'duplicate'); assert.equal(blocked.error.duplicateOf, first.recordId);
  assert.equal(s._adapters.calendar.stats.executions, 1);
  const allowed = await confirmed(s, other, { allowDuplicate: true });
  assert.equal(allowed.status, 'completed');
  assert.equal(s.list().length, 2);
});

test('revision 2 supersedes revision 1: same calendar entry updated, old record marked', async () => {
  const s = svc({ mode: 'real', real: 'ics' });
  const r1 = await confirmed(s);
  const r2 = await confirmed(s, mkIntent({ revision: 2, when: { precision: 'exact', startIso: '2026-11-14T10:00:00+09:00', tz: 'Asia/Seoul' } }));
  assert.notEqual(r1.recordId, r2.recordId);
  assert.match(s.getArtifact(r2.recordId).content, /SEQUENCE:1/);
  const uid = (r) => /UID:(\S+)/.exec(s.getArtifact(r.recordId).content)[1];
  assert.equal(uid(r1), uid(r2), 'stable UID across revisions');
  assert.equal(s.list().find((x) => x.recordId === r1.recordId).supersededByRevision, 2);
});

// ---------------------------------------------------------------- faults
test('all documented fault names are supported and unknown faults are rejected at setup', () => {
  assert.deepEqual([...FAULTS].sort(), ['api_500', 'lost_response', 'mismatch', 'network', 'permission_denied', 'slow', 'timeout']);
  assert.throws(() => svc({ fault: 'bogus' }), /unknown fault/);
});

for (const variant of ['simulated', 'ics', 'local']) {
  const vopts = variant === 'simulated' ? { mode: 'simulated' } : { mode: 'real', real: variant };
  const okStatus = variant === 'ics' ? 'handed_off' : 'completed';
  test(`[${variant}] permission_denied: never success; pre_send retryable; retry after fix works`, async () => {
    const s = svc({ ...vopts, fault: 'permission_denied' });
    const r = await confirmed(s);
    assert.equal(r.status, 'permission_denied');
    assert.equal(r.error.phase, 'pre_send'); assert.equal(r.error.retryable, true);
    assert.equal(r.testFault, 'permission_denied');
    assert.doesNotMatch(r.readbackText.en, SUCCESS_WORDS); assert.doesNotMatch(r.readbackText.ko, KO_SUCCESS);
    assert.match(r.readbackText.en, /Nothing was sent/);
    assert.equal(s.getArtifact(r.recordId), null);
    s.setFault(null);
    const intent = mkIntent();
    const retry = await s.confirm({ intent, previewDigest: s.preview(intent).previewDigest });
    assert.equal(retry.recordId, r.recordId);
    assert.equal(retry.status, okStatus);
    assert.equal(retry.attempts, 2);
    assert.equal(s.list().length, 1);
  });

  test(`[${variant}] network: failed pre_send, retry allowed, no success wording`, async () => {
    const s = svc({ ...vopts, fault: { type: 'network', times: 1 } });
    const r = await confirmed(s);
    assert.equal(r.status, 'failed'); assert.equal(r.error.code, 'network'); assert.equal(r.error.phase, 'pre_send'); assert.equal(r.error.retryable, true);
    assert.doesNotMatch(r.readbackText.en, SUCCESS_WORDS);
    const retry = await confirmed(s);
    assert.ok(['completed', 'handed_off'].includes(retry.status));
  });

  test(`[${variant}] timeout: unknown_outcome, no blind retry, honest copy`, async () => {
    const s = svc({ ...vopts, fault: 'timeout' });
    const r = await confirmed(s);
    assert.equal(r.status, 'unknown_outcome');
    assert.equal(r.error.code, 'timeout'); assert.equal(r.error.phase, 'post_send'); assert.equal(r.error.retryable, false);
    assert.doesNotMatch(r.readbackText.en, SUCCESS_WORDS); assert.doesNotMatch(r.readbackText.en, /nothing (was )?(sent|saved)/i);
    assert.match(r.readbackText.en, /check your calendar/i);
    const execs = (x) => (x._adapters.calendar.stats.executions);
    const before = execs(s);
    const again = await confirmed(s);
    assert.equal(again.status, 'unknown_outcome'); assert.equal(again.deduplicated, true);
    assert.equal(execs(s), before, 'confirm never re-executes an unknown outcome');
  });

  test(`[${variant}] api_500: post_send => unknown_outcome, not failed-retryable`, async () => {
    const r = await confirmed(svc({ ...vopts, fault: 'api_500' }));
    assert.equal(r.status, 'unknown_outcome'); assert.equal(r.error.retryable, false); assert.equal(r.error.phase, 'post_send');
    assert.doesNotMatch(r.readbackText.en, SUCCESS_WORDS);
  });

  test(`[${variant}] mismatch: verify_mismatch, nothing offered as done`, async () => {
    const s = svc({ ...vopts, fault: 'mismatch' });
    const r = await confirmed(s);
    assert.equal(r.status, 'verify_mismatch');
    assert.ok(r.error.mismatch.includes('startsAt'));
    assert.equal(displayState(r), 'verify_mismatch');
    assert.equal(s.getArtifact(r.recordId), null, 'a file that failed verification is never handed out');
    assert.doesNotMatch(r.readbackText.en, SUCCESS_WORDS);
  });

  test(`[${variant}] slow (under timeout): still completes through the normal path`, async () => {
    const r = await confirmed(svc({ ...vopts, fault: 'slow', slowMs: 5, timeoutMs: 500 }));
    assert.equal(r.status, okStatus);
  });
}

test('lost_response (simulated): unknown_outcome, then readback reconciles to completed without a second execution', async () => {
  const s = svc({ fault: 'lost_response' });
  const r = await confirmed(s);
  assert.equal(r.status, 'unknown_outcome'); assert.equal(r.error.code, 'lost_response');
  assert.equal(s._adapters.calendar.size(), 1, 'the write did happen');
  const rb = await s.readback(r.recordId);
  assert.equal(rb.status, 'completed'); assert.equal(rb.mode, 'simulated'); assert.equal(rb.verifyLevel, 'none');
  assert.equal(s._adapters.calendar.stats.executions, 1);
});

test('lost_response (ics): cannot be reconciled, stays unknown_outcome and tells the user to check', async () => {
  const s = svc({ mode: 'real', real: 'ics', fault: 'lost_response' });
  const r = await confirmed(s);
  assert.equal(r.status, 'unknown_outcome');
  const rb = await s.readback(r.recordId);
  assert.equal(rb.status, 'unknown_outcome');
  assert.equal(rb.reconcile.result, 'cannot_verify');
  assert.equal(s.getArtifact(r.recordId), null);
});

test('timeout (simulated): readback finds nothing written => failed pre_send retryable, retry then succeeds once', async () => {
  const s = svc({ fault: { type: 'timeout', times: 1 } });
  const r = await confirmed(s);
  assert.equal(r.status, 'unknown_outcome');
  const rb = await s.readback(r.recordId);
  assert.equal(rb.status, 'failed'); assert.equal(rb.error.phase, 'pre_send'); assert.equal(rb.error.retryable, true); assert.equal(rb.error.reconciled, true);
  const retry = await confirmed(s);
  assert.equal(retry.status, 'completed');
  assert.equal(s._adapters.calendar.size(), 1);
});

test('slow beyond timeout: unknown_outcome first; late write found by readback (no duplicate on later reconcile)', async () => {
  const s = svc({ fault: 'slow', slowMs: 80, timeoutMs: 20 });
  const r = await confirmed(s);
  assert.equal(r.status, 'unknown_outcome'); assert.equal(r.error.code, 'timeout');
  await new Promise((res) => setTimeout(res, 120));
  const rb = await s.readback(r.recordId);
  assert.equal(rb.status, 'completed');
  assert.equal(s._adapters.calendar.size(), 1);
});

test('readback of a simulated completed entry that vanished is reported as a mismatch, not success', async () => {
  const s = svc();
  const r = await confirmed(s);
  assert.equal((await s.readback(r.recordId)).status, 'completed'); // baseline: still present
  const uid = `sj-${createHash('sha256').update('prop_1').digest('hex').slice(0, 24)}@ebys.local`;
  await s._adapters.calendar.remove({ op: { uid } }); // simulate the entry disappearing behind our back
  const rb = await s.readback(r.recordId);
  assert.equal(rb.status, 'verify_mismatch');
  assert.equal(rb.error.code, 'missing_on_readback');
  assert.doesNotMatch(rb.readbackText.en, SUCCESS_WORDS);
});

test('cancel: simulated removal is verified; handed-off cancel admits it cannot confirm', async () => {
  const sim = svc();
  const a = await confirmed(sim);
  const ca = await sim.cancel(a.recordId);
  assert.equal(ca.status, 'cancelled'); assert.equal(sim._adapters.calendar.size(), 0);
  assert.match(ca.readbackText.en, /Removed from the simulated calendar and checked/);
  const real = svc({ mode: 'real', real: 'ics' });
  const b = await confirmed(real);
  const cb = await real.cancel(b.recordId);
  assert.equal(cb.status, 'cancelled');
  assert.match(cb.readbackText.en, /can't tell whether you already saved it/);
  assert.equal(real.getArtifact(b.recordId), null);
});

test('readback/cancel of unknown record is an error value', async () => {
  const s = svc();
  assert.equal((await s.readback('nope')).error.code, 'not_found');
  assert.equal((await s.cancel('nope')).error.code, 'not_found');
});

test('purge: session-scoped, verified, with receipt line and related stores', async () => {
  const s = svc({ mode: 'real', real: 'ics' });
  await confirmed(s, mkIntent({ intentId: 'p1', sessionId: 'A' }));
  await confirmed(s, mkIntent({ intentId: 'p2', sessionId: 'B', who: undefined, person: { displayName: 'Jisoo', speakerConfidence: 'confirmed' } }));
  const line = s.purge({ sessionId: 'A' });
  assert.equal(line.name, 'action_ledger'); assert.equal(line.status, 'verified_deleted');
  assert.equal(s.list().length, 1); assert.equal(s.list()[0].intentId, 'p2');
  assert.deepEqual(line.related.map((x) => [x.name, x.status]), [['exported_file', 'not_verified'], ['external_calendar', 'not_applicable']]);
  const all = s.purge();
  assert.equal(all.status, 'verified_deleted'); assert.equal(s.list().length, 0);
  assert.equal(all.related[0].name, 'exported_file');
  // purging the simulated service also clears the in-app calendar
  const sim = svc();
  await confirmed(sim);
  assert.equal(sim.purge({ sessionId: 's1' }).related[0].status, 'not_applicable');
  assert.equal(sim._adapters.calendar.size(), 0);
  // a record purged can be created again (idempotency index is gone too)
  assert.equal((await confirmed(sim)).status, 'completed');
});

test('describe(): RuntimeInfo is honest about simulated vs real and unavailable capture', () => {
  const sim = svc().describe();
  assert.equal(sim.data, 'synthetic'); assert.equal(sim.micCapture, 'unavailable'); assert.equal(sim.speechInput, 'unavailable');
  assert.equal(sim.calendar.kind, 'simulated'); assert.equal(sim.notifications.kind, 'preview');
  assert.equal(sim.adapters.find((a) => a.id === 'notification.preview').claimStatus, 'simulated');
  assert.equal(sim.faultInjection, null);
  const real = svc({ mode: 'real', real: 'ics', fault: 'network' }).describe();
  assert.equal(real.calendar.kind, 'ics_handoff'); assert.equal(real.adapters[0].claimStatus, 'unverified'); assert.equal(real.adapters[0].maxVerifyLevel, 'handoff');
  assert.equal(real.faultInjection.active, 'network');
  assert.ok(sim.version);
});

test('mode/adapter mislabel guard', async () => {
  const { createSimulatedCalendarAdapter, createIcsHandoffAdapter } = await import('./calendar-adapters.mjs');
  assert.throws(() => createActionService({ now, mode: 'real', adapters: { calendar: createSimulatedCalendarAdapter() } }), /refusing to mislabel/);
  assert.throws(() => createActionService({ now, mode: 'simulated', adapters: { calendar: createIcsHandoffAdapter() } }), /refusing to mislabel/);
  assert.throws(() => createActionService({ now, mode: 'bogus' }), /mode must be/);
});

test('invalid inputs are error values, not exceptions', async () => {
  const s = svc();
  assert.equal((await s.confirm()).error.code, 'invalid_intent');
  assert.equal((await s.confirm({ intent: null })).error.code, 'invalid_intent');
  assert.equal(s.preview(null).needs_clarification, true);
});

// ---------------------------------------------------------------- intentFromProposal
const proposal = (o = {}) => ({
  id: 'prop_9', revision: 3, state: 'proposed', missing: [], slotUncertainty: { who: 'stated', when: 'stated' }, evidence: [{ utteranceId: 'u1', charStart: 0, charEnd: 4, quote: 'Lunc' }],
  fields: { kind: 'appointment', title: 'Dentist', who: 'Dr. Han', startsAt: '2026-11-12T10:00:00+09:00', endsAt: '2026-11-12T10:30:00+09:00', where: 'Clinic', remindOffsetsMin: [60], sourceMemoryIds: ['m1'] }, ...o,
});

test('intentFromProposal: exact, duration from endsAt, ids carried, speaker confidence mapped', () => {
  const i = intentFromProposal(proposal(), { sessionId: 'S' });
  assert.equal(i.intentId, 'prop_9'); assert.equal(i.revision, 3); assert.equal(i.kind, 'appointment');
  assert.equal(i.when.precision, 'exact'); assert.equal(i.when.durationMin, 30); assert.equal(i.person.speakerConfidence, 'confirmed');
  assert.equal(i.sessionId, 'S'); assert.equal(i.place, 'Clinic'); assert.deepEqual(i.reminderOffsetsMin, [60]);
  assert.equal(i.proposalState, 'proposed');
  const s = svc();
  assert.equal(s.preview(i).fields.durationMin, 30);
});

test('intentFromProposal: never upgrades uncertain or partial times to exact', () => {
  assert.equal(intentFromProposal(proposal({ fields: { ...proposal().fields, startsAt: '2026-11-12' } })).when.precision, 'date_only');
  assert.equal(intentFromProposal(proposal({ fields: { ...proposal().fields, startsAt: '2026-11-12T02:00' } })).when.precision, 'ambiguous');
  assert.equal(intentFromProposal(proposal({ slotUncertainty: { when: 'ambiguous' } })).when.precision, 'ambiguous');
  assert.equal(intentFromProposal(proposal({ slotUncertainty: { when: 'approximate' } })).when.precision, 'ambiguous');
  assert.equal(intentFromProposal(proposal({ missing: ['when'] })).when.precision, 'unknown');
  assert.equal(intentFromProposal(proposal({ fields: { kind: 'todo', title: 'Call back' } })).kind, 'reminder');
  const unknown = intentFromProposal(proposal({ fields: { kind: 'todo', title: 'Call back' } }));
  assert.equal(svc().preview(unknown).needs_clarification, true);
  assert.equal(intentFromProposal(proposal({ fields: { ...proposal().fields, who: undefined } })).person.speakerConfidence, 'unknown');
});
