import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createActionService } from './action-service.mjs';
import { createLocalCalendarAdapter, cleanEvent, cleanTask } from './calendar-local.mjs';
import { displayState } from '../contracts/contracts.js';

const dir = () => mkdtempSync(join(tmpdir(), 'ebys-cal-'));
const NOW = '2026-11-09T10:30:00+09:00';
const mkIntent = (o = {}) => ({
  intentId: 'prop_1', revision: 1, kind: 'appointment', title: 'Lunch', person: { displayName: 'Minsu', speakerConfidence: 'confirmed' },
  when: { precision: 'exact', startIso: '2026-11-13T15:00:00+09:00', tz: 'Asia/Seoul' }, place: 'Han River Cafe',
  reminderOffsetsMin: [60, 1440], sourceRefs: [], uncertainty: [], sessionId: 'A', ...o,
});
const mk = (file, o = {}) => createActionService({ now: () => NOW, mode: 'real', calendarFile: file, timeoutMs: 40, slowMs: 5, ...o });
const confirmed = async (s, it = mkIntent(), extra = {}) => s.confirm({ intent: it, previewDigest: s.preview(it).previewDigest, ...extra });
const readFile = (f) => JSON.parse(readFileSync(f, 'utf8'));
const NOT_PHONE = /(?<!not (?:your |the )?)phone calendar/i;

test('real default is the EBYS-local calendar: completed + real + api_readback, file on disk, honest labels', async () => {
  const file = join(dir(), 'calendar.json');
  const s = mk(file);
  assert.equal(s.describe().adapters[0].id, 'calendar.local');
  const r = await confirmed(s);
  assert.equal(r.status, 'completed'); assert.equal(r.mode, 'real'); assert.equal(r.verifyLevel, 'api_readback');
  assert.equal(r.adapterId, 'calendar.local');
  assert.equal(displayState(r), 'completed_external');
  assert.match(r.readbackText.en, /Saved in the EBYS calendar on this device and read back to check/);
  assert.match(r.readbackText.en, /Minsu/); assert.match(r.readbackText.en, /13 Nov 2026, 3:00 PM/);
  assert.match(r.readbackText.ko, /이 기기의 EBYS 달력에 저장하고 다시 읽어 확인했습니다/);
  const all = JSON.stringify({ r, p: s.preview(mkIntent()), d: s.describe() });
  assert.doesNotMatch(all, NOT_PHONE, 'never claims the phone calendar');
  assert.equal(s.describe().calendar.kind, 'ebys_local');
  assert.equal(s.describe().adapters[0].claimStatus, 'demonstrated');
  const c = readFile(file);
  assert.equal(c.events.length, 1);
  const e = c.events[0];
  assert.equal(e.title, 'Lunch'); assert.equal(e.start, '2026-11-13T15:00'); assert.equal(e.startsAt, '2026-11-13T15:00:00+09:00');
  assert.equal(e.location, 'Han River Cafe'); assert.equal(e.who, 'Minsu'); assert.deepEqual(e.reminders, [1440, 60]);
  assert.equal(e.type, 'appointment'); assert.equal(e.source, 'EBYS (synthetic demo)'); assert.equal(e.allDay, false);
  assert.ok(!JSON.stringify(c).includes('transcript'));
  assert.deepEqual(readdirSync(dirname(file)), ['calendar.json'], 'no .tmp left behind after the atomic write');
});

test('readback re-reads the file: tampering after confirm is detected, not reported as done', async () => {
  const file = join(dir(), 'calendar.json');
  const s = mk(file);
  const r = await confirmed(s);
  assert.equal((await s.readback(r.recordId)).status, 'completed');
  const c = readFile(file); c.events[0].startsAt = '2026-11-13T16:00:00+09:00'; c.events[0].start = '2026-11-13T16:00';
  writeFileSync(file, JSON.stringify(c));
  const rb = await s.readback(r.recordId);
  assert.equal(rb.status, 'verify_mismatch'); assert.ok(rb.error.mismatch.includes('startsAt'));
  assert.doesNotMatch(rb.readbackText.en, /\bsaved\b/i);
});

test('readback: an entry deleted from the file behind our back is reported as missing, not done', async () => {
  const file = join(dir(), 'calendar.json');
  const s = mk(file);
  const r = await confirmed(s);
  const c = readFile(file); c.events = []; writeFileSync(file, JSON.stringify(c));
  const gone = await s.readback(r.recordId);
  assert.equal(gone.status, 'verify_mismatch'); assert.equal(gone.error.code, 'missing_on_readback');
});

test('idempotent across a server restart: same intent in a NEW service updates the same entry, no duplicate', async () => {
  const file = join(dir(), 'calendar.json');
  await confirmed(mk(file));
  const s2 = mk(file);
  const again = await confirmed(s2);
  assert.equal(again.status, 'completed');
  assert.equal(readFile(file).events.length, 1);
});

test('revision 2 updates the same entry (stable uid), sequence bumps, reminder bookkeeping resets', async () => {
  const file = join(dir(), 'calendar.json');
  const s = mk(file);
  await confirmed(s);
  s.dueNotifications('2026-11-12T15:00:00+09:00'); // marks the 1-day reminder done
  assert.deepEqual(readFile(file).events[0].remindersDone, [1440]);
  const r2 = await confirmed(s, mkIntent({ revision: 2, when: { precision: 'exact', startIso: '2026-11-14T10:00:00+09:00', tz: 'Asia/Seoul' } }));
  assert.equal(r2.status, 'completed');
  const c = readFile(file);
  assert.equal(c.events.length, 1); assert.equal(c.events[0].startsAt, '2026-11-14T10:00:00+09:00');
  assert.equal(c.events[0].sequence, 1); assert.deepEqual(c.events[0].remindersDone, []);
});

test('corrupt calendar file is never overwritten (the source silently started empty)', async () => {
  const file = join(dir(), 'calendar.json');
  writeFileSync(file, '{ not json');
  const s = mk(file);
  const r = await confirmed(s);
  assert.equal(r.status, 'failed'); assert.equal(r.error.code, 'calendar_corrupt'); assert.equal(r.error.phase, 'pre_send'); assert.equal(r.error.retryable, false);
  assert.equal(readFileSync(file, 'utf8'), '{ not json');
  assert.doesNotMatch(r.readbackText.en, /\bsaved\b/i);
  assert.equal(s.dueNotifications().ok, false);
});

test('storage failure (cannot create the directory) is failed + pre_send + retryable, never success', async () => {
  const base = dir();
  const blocker = join(base, 'file-not-dir'); writeFileSync(blocker, 'x');
  const s = mk(join(blocker, 'calendar.json')); // parent is a file => mkdir fails
  const r = await confirmed(s);
  assert.equal(r.status, 'failed'); assert.equal(r.error.code, 'storage_error'); assert.equal(r.error.phase, 'pre_send'); assert.equal(r.error.retryable, true);
  assert.match(r.readbackText.en, /Nothing was sent/);
  assert.ok(r.error.userHint.ko && r.error.userHint.en);
});

test('mismatch: bad write is rolled back (new entry removed; earlier revision restored)', async () => {
  const file = join(dir(), 'calendar.json');
  const s = mk(file, { fault: { type: 'mismatch', times: 1 } });
  const r = await confirmed(s);
  assert.equal(r.status, 'verify_mismatch'); assert.equal(r.error.rolledBack, true);
  assert.equal(readFile(file).events.length, 0);
  const ok = await confirmed(s, mkIntent({ intentId: 'prop_2', who: undefined, person: { displayName: 'Jisoo', speakerConfidence: 'confirmed' } }));
  assert.equal(ok.status, 'completed');
  s.setFault({ type: 'mismatch', times: 1 });
  const bad = await confirmed(s, mkIntent({ intentId: 'prop_2', revision: 2, person: { displayName: 'Jisoo', speakerConfidence: 'confirmed' }, when: { precision: 'exact', startIso: '2026-11-15T09:00:00+09:00', tz: 'Asia/Seoul' } }));
  assert.equal(bad.status, 'verify_mismatch');
  const e = readFile(file).events[0];
  assert.equal(e.startsAt, '2026-11-13T15:00:00+09:00', 'previous good revision restored');
});

test('lost_response (local): unknown_outcome, readback finds the entry in the file => completed with api_readback, one write', async () => {
  const file = join(dir(), 'calendar.json');
  const s = mk(file, { fault: 'lost_response' });
  const r = await confirmed(s);
  assert.equal(r.status, 'unknown_outcome');
  const rb = await s.readback(r.recordId);
  assert.equal(rb.status, 'completed'); assert.equal(rb.verifyLevel, 'api_readback');
  assert.equal(s._adapters.calendar.stats.executions, 1); assert.equal(readFile(file).events.length, 1);
});

// ------------------------------------------------------------- reminder sweep (rules ported from the bridge)
test('sweep: offsets the user chose fire once each, at the right time, with source-style title', async () => {
  const file = join(dir(), 'calendar.json');
  const s = mk(file);
  await confirmed(s);
  const at = (t) => s.dueNotifications(t, { since: last });
  let last = 0;
  assert.equal(s.dueNotifications('2026-11-12T14:59:00+09:00').notifications.length, 0);
  let out = s.dueNotifications('2026-11-12T15:00:00+09:00');
  assert.equal(out.notifications.length, 1);
  const nt = out.notifications[0];
  assert.equal(nt.offsetMin, 1440); assert.equal(nt.title.ko, '15:00 Lunch · Han River Cafe'); assert.equal(nt.type, 'reminder');
  assert.equal(nt.fireAt, '2026-11-12T15:00:00+09:00'); assert.equal(nt.delivery, 'in_app_poll'); assert.equal(nt.mode, 'real');
  assert.match(nt.label.en, /not a phone notification/); assert.ok(nt.recordId);
  assert.equal(nt.n, 1); last = out.lastN;
  assert.equal(at('2026-11-12T15:05:00+09:00').notifications.length, 0, 'already delivered, not repeated');
  out = at('2026-11-13T14:00:00+09:00');
  assert.equal(out.notifications.length, 1); assert.equal(out.notifications[0].offsetMin, 60); assert.equal(out.notifications[0].n, 2); last = out.lastN;
  assert.equal(at('2026-11-13T14:40:00+09:00').notifications.length, 0);
  assert.equal(at('2026-11-13T15:30:00+09:00').notifications.length, 0, 'after the start nothing fires');
  assert.equal(s.dueNotifications('2026-11-12T15:00:00+09:00', { since: 0 }).notifications.length, 2, 'poll with since=0 returns the persisted queue');
});

test('sweep: after downtime only the nearest due reminder is emitted (no spam)', async () => {
  const s = mk(join(dir(), 'calendar.json'));
  await confirmed(s);
  const out = s.dueNotifications('2026-11-13T14:30:00+09:00');
  assert.equal(out.notifications.length, 1); assert.equal(out.notifications[0].offsetMin, 60);
  assert.equal(s.dueNotifications('2026-11-13T14:31:00+09:00').notifications.length, 1, 'still just that one in the queue');
});

test('sweep: default 30 min before when no offsets were chosen (source rule)', async () => {
  const s = mk(join(dir(), 'calendar.json'));
  await confirmed(s, mkIntent({ reminderOffsetsMin: [] }));
  assert.equal(s.dueNotifications('2026-11-13T14:29:00+09:00').notifications.length, 0);
  const out = s.dueNotifications('2026-11-13T14:30:00+09:00');
  assert.equal(out.notifications.length, 1); assert.equal(out.notifications[0].offsetMin, 30);
});

test('sweep: all-day events at 08:00 KST, tasks due today at 09:00 KST, done tasks never', () => {
  const file = join(dir(), 'calendar.json');
  const a = createLocalCalendarAdapter({ file });
  const ms = (s) => Date.parse(s);
  a.addEvent({ title: 'Anniversary', start: '2026-11-13' }, { nowMs: ms(NOW) });
  a.addTask({ title: 'Pick up medicine', due: '2026-11-13' }, { nowMs: ms(NOW) });
  a.addTask({ title: 'Already done', due: '2026-11-13', status: 'done' }, { nowMs: ms(NOW) });
  assert.equal(a.sweep(ms('2026-11-13T07:59:00+09:00')).length, 0);
  assert.equal(a.sweep(ms('2026-11-13T08:00:00+09:00')).map((x) => x.title.en).join(), 'Today: Anniversary');
  assert.equal(a.sweep(ms('2026-11-13T08:30:00+09:00')).length, 0);
  assert.equal(a.sweep(ms('2026-11-13T09:00:00+09:00')).map((x) => x.title.en).join(), 'Due today: Pick up medicine');
  assert.equal(a.sweep(ms('2026-11-13T10:00:00+09:00')).length, 0);
  a.addEvent({ title: 'Missed day', start: '2026-11-10' }, { nowMs: ms(NOW) });
  assert.equal(a.sweep(ms('2026-11-11T08:00:00+09:00')).length, 0, 'a missed all-day event is closed silently');
  assert.equal(a.notificationsSince(0).length, 2);
});

test('cleanEvent/cleanTask keep the source validation rules', () => {
  assert.throws(() => cleanEvent({ title: 'x', start: 'tomorrow' }), /bad start/);
  assert.throws(() => cleanEvent({ title: '', start: '2026-11-13' }), /title and start/);
  assert.equal(cleanEvent({ title: 'x'.repeat(300), start: '2026-11-13T15:00:59' }).title.length, 120);
  assert.equal(cleanEvent({ title: 'x', start: '2026-11-13T15:00:59' }).start, '2026-11-13T15:00');
  assert.equal(cleanEvent({ title: 'x', start: '2026-11-13', end: '2026-11-14T10:00' }).end, null, 'all-day has no end time');
  assert.equal(cleanEvent({ title: 'x', start: '2026-11-13T10:00', type: 'bogus' }).type, 'appointment');
  assert.throws(() => cleanTask({ title: '' }), /title required/);
  assert.equal(cleanTask({ title: 't', due: 'soon' }).due, null);
  assert.equal(cleanTask({ title: 't' }).status, 'todo');
});

test('non-local adapters have no reminder source (honest: source none)', () => {
  const sim = createActionService({ now: () => NOW, mode: 'simulated' });
  assert.deepEqual(sim.dueNotifications('2026-11-13T14:30:00+09:00'), { ok: true, source: 'none', now: '2026-11-09T10:30:00+09:00', notifications: [], lastN: 0 });
  assert.equal(createActionService({ now: () => NOW, mode: 'real', real: 'ics' }).dueNotifications().source, 'none');
});

// ------------------------------------------------------------- cancel / purge
test('cancel (local): entry and its reminders are removed and verified; later sweeps stay quiet', async () => {
  const file = join(dir(), 'calendar.json');
  const s = mk(file);
  const r = await confirmed(s);
  s.dueNotifications('2026-11-12T15:00:00+09:00');
  const c = await s.cancel(r.recordId);
  assert.equal(c.status, 'cancelled');
  assert.match(c.readbackText.en, /Removed from the EBYS calendar on this device and read back to check/);
  const f = readFile(file);
  assert.equal(f.events.length, 0); assert.equal(f.notifications.length, 0);
  assert.equal(s.dueNotifications('2026-11-13T14:00:00+09:00').notifications.length, 0);
});

test('cancel does not claim success when removal cannot be verified', async () => {
  const file = join(dir(), 'calendar.json');
  const s = mk(file);
  const r = await confirmed(s);
  writeFileSync(file, 'garbage');
  const c = await s.cancel(r.recordId);
  assert.equal(c.status, 'completed', 'status unchanged');
  assert.equal(c.error.code, 'cancel_unconfirmed');
});

test('purge: session-scoped and full, verified by re-reading the file, including entries from before a restart', async () => {
  const file = join(dir(), 'calendar.json');
  const s1 = mk(file);
  await confirmed(s1, mkIntent({ intentId: 'a1', sessionId: 'A' }));
  await confirmed(s1, mkIntent({ intentId: 'b1', sessionId: 'B', person: { displayName: 'Jisoo', speakerConfidence: 'confirmed' } }));
  s1.dueNotifications('2026-11-12T15:00:00+09:00');
  assert.equal(readFile(file).notifications.length, 2);
  const s2 = mk(file); // "restarted": empty ledger, entries only in the file
  const line = s2.purge({ sessionId: 'A' });
  assert.equal(line.name, 'action_ledger');
  const rel = Object.fromEntries(line.related.map((x) => [x.name, x]));
  assert.equal(rel.local_calendar.status, 'verified_deleted'); assert.match(rel.local_calendar.detail, /removed 1 event/);
  assert.equal(rel.notification_queue.status, 'verified_deleted');
  assert.equal(rel.external_calendar.status, 'not_applicable'); assert.equal(rel.exported_file.status, 'not_applicable');
  const f = readFile(file);
  assert.deepEqual(f.events.map((e) => e.intentId), ['b1']);
  assert.deepEqual([...new Set(f.notifications.map((n) => n.uid))].length, 1);
  const all = s2.purge();
  assert.equal(all.related.find((x) => x.name === 'local_calendar').status, 'verified_deleted');
  const g = readFile(file);
  assert.equal(g.events.length, 0); assert.equal(g.notifications.length, 0); assert.equal(g.tasks.length, 0);
});

test('purge reports not_verified when the file cannot be read', async () => {
  const file = join(dir(), 'calendar.json');
  const s = mk(file);
  await confirmed(s);
  writeFileSync(file, 'garbage');
  const rel = Object.fromEntries(s.purge().related.map((x) => [x.name, x]));
  assert.equal(rel.local_calendar.status, 'not_verified');
});

test('default calendar path is senior-jarvis/.data/calendar.json (not created by merely constructing a service)', async () => {
  const { DEFAULT_CALENDAR_FILE } = await import('./calendar-local.mjs');
  assert.match(decodeURIComponent(DEFAULT_CALENDAR_FILE.pathname), /senior-jarvis\/\.data\/calendar\.json$/);
  const before = existsSync(DEFAULT_CALENDAR_FILE);
  createActionService({ now: () => NOW, mode: 'real' }).describe();
  assert.equal(existsSync(DEFAULT_CALENDAR_FILE), before, 'constructing/describing never writes');
  void rmSync;
});
