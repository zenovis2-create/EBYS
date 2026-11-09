// English-first acceptance for the action layer (owner priority, 2026-11-09 11:24 KST).
// Scope: unit level. These tests do NOT prove live model behaviour, a real browser, or voice; those belong to QA.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createActionService } from './action-service.mjs';
import { intentFromProposal } from './intent.mjs';
import { displayDateTime, displayParts, localize, DEFAULT_LANG } from './format.mjs';
import { parseExactIso } from './format.mjs';

const NOW = '2026-11-09T10:30:00+09:00';
const HANGUL = /[\u3131-\u318E\uAC00-\uD7A3]/;
const SNAKE = /\b[a-z]+_[a-z_]+\b/; // internal codes must never leak into user-facing English
const tmp = () => join(mkdtempSync(join(tmpdir(), 'ebys-en-')), 'calendar.json');

// ENGLISH synthetic intent (no Korean anywhere in the input)
const intent = (o = {}) => ({
  intentId: 'en_1', revision: 1, kind: 'appointment', title: 'Dental check-up', person: { displayName: 'Dr. Patel', speakerConfidence: 'confirmed' },
  when: { precision: 'exact', startIso: '2026-11-12T15:30:00+09:00', tz: 'Asia/Seoul' }, place: 'Maple Street Clinic',
  reminderOffsetsMin: [60, 1440], sourceRefs: [], uncertainty: [], sessionId: 'S', ...o,
});
const variants = {
  simulated: (o = {}) => createActionService({ now: () => NOW, mode: 'simulated', timeoutMs: 40, slowMs: 5, ...o }),
  ics: (o = {}) => createActionService({ now: () => NOW, mode: 'real', real: 'ics', timeoutMs: 40, slowMs: 5, ...o }),
  local: (o = {}) => createActionService({ now: () => NOW, mode: 'real', real: 'local', calendarFile: tmp(), timeoutMs: 40, slowMs: 5, ...o }),
};
const go = async (s, it = intent()) => s.confirm({ intent: it, previewDigest: s.preview(it).previewDigest });

/** Collect every {ko,en} copy object anywhere in a value. */
function copyObjects(v, out = []) {
  if (Array.isArray(v)) v.forEach((x) => copyObjects(x, out));
  else if (v && typeof v === 'object') {
    if (typeof v.en === 'string' && typeof v.ko === 'string') out.push(v);
    else for (const [k, x] of Object.entries(v)) if (k !== 'calendarLabel') copyObjects(x, out); // calendarLabel is a mid-sentence noun phrase, not a sentence
  }
  return out;
}

async function everyScenarioOutput() {
  const outs = [];
  for (const [name, mk] of Object.entries(variants)) {
    const s = mk();
    const p = s.preview(intent());
    const ok = await go(s);
    outs.push(p, ok, s.describe(), await s.readback(ok.recordId), await s.cancel(ok.recordId));
    outs.push(s.preview(intent({ when: { precision: 'ambiguous', tz: 'Asia/Seoul' } })));
    outs.push(s.preview(intent({ when: { precision: 'date_only', tz: 'Asia/Seoul' } })));
    outs.push(s.preview(intent({ when: { precision: 'unknown', tz: 'Asia/Seoul' } })));
    outs.push(await s.confirm({ intent: intent({ proposalState: 'cancelled', intentId: `c_${name}` }), previewDigest: s.preview(intent({ intentId: `c_${name}` })).previewDigest }));
    outs.push(await s.confirm({ intent: intent({ intentId: `d_${name}` }), previewDigest: 'wrong' }));
    outs.push(await s.confirm({ intent: intent({ intentId: `e_${name}` }) }));
    outs.push(await s.confirm({ intent: null }));
    outs.push(await s.readback('missing'));
    for (const fault of ['permission_denied', 'network', 'timeout', 'api_500', 'lost_response', 'mismatch']) {
      const f = mk({ fault });
      outs.push(await go(f, intent({ intentId: `f_${fault}` })));
    }
  }
  return outs;
}

test('English is the default language everywhere; Korean remains optional', async () => {
  assert.equal(DEFAULT_LANG, 'en');
  assert.equal(localize({ ko: '안녕', en: 'Hello' }), 'Hello');
  assert.equal(localize({ ko: '안녕', en: 'Hello' }, 'ko'), '안녕');
  assert.equal(localize({ ko: '안녕' }), '안녕', 'falls back to Korean only if English is missing');
  assert.equal(variants.simulated().describe().defaultLang, 'en');
  const objs = copyObjects(await everyScenarioOutput());
  assert.ok(objs.length > 150, `expected a broad sample, got ${objs.length}`);
  const withKo = objs.filter((o) => HANGUL.test(o.ko));
  assert.ok(withKo.length > 50, 'optional Korean copy was not removed');
});

test('every English string is non-empty, has no Hangul (English input) and leaks no internal codes', async () => {
  const objs = copyObjects(await everyScenarioOutput());
  for (const o of objs) {
    assert.ok(o.en.trim().length > 0, 'empty English copy');
    assert.doesNotMatch(o.en, HANGUL, `Korean leaked into English copy: ${o.en}`);
    // user data (title/person/place) is English here, so a snake_case token can only be an internal code
    assert.doesNotMatch(o.en, SNAKE, `internal code leaked: ${o.en}`);
    assert.doesNotMatch(o.en, /\b(undefined|null|NaN|\[object)/, `bad interpolation: ${o.en}`);
  }
});

test('English copy reads naturally: no placeholder phrasing, sentences are complete', async () => {
  const objs = copyObjects(await everyScenarioOutput());
  const system = objs.filter((o) => o.en.length > 25); // skip bare data values like "Dr. Patel"
  for (const { en } of system) {
    assert.match(en, /[.?!)]$|[A-Za-z0-9)]$/, en);
    assert.doesNotMatch(en, /\s{2,}/, `double space: ${en}`);
    assert.doesNotMatch(en, /^[a-z]/, `starts lowercase: ${en}`);
    assert.doesNotMatch(en, /\b(please do not|kindly|pursuant|herein|utilize)\b/i, en);
  }
});

test('time and time zone are always explicit and AM/PM is correct', async () => {
  const s = variants.local();
  const p = s.preview(intent());
  assert.equal(p.display.when.en, 'Thu, 12 Nov 2026, 3:30 PM (Seoul time, UTC+9)');
  assert.deepEqual({ ...p.display.whenParts, weekday: undefined, date: undefined }, { ...displayParts(parseExactIso('2026-11-12T15:30:00+09:00')), weekday: undefined, date: undefined });
  assert.equal(p.display.whenParts.iana, 'Asia/Seoul'); assert.equal(p.display.whenParts.utcLabel, 'UTC+9'); assert.equal(p.display.whenParts.time12, '3:30 PM');
  const r = await go(s);
  assert.match(r.readbackText.en, /Appointment: Dental check-up with Dr\. Patel, Thu, 12 Nov 2026, 3:30 PM \(Seoul time, UTC\+9\)/);
  assert.equal(s.describe().timezone.iana, 'Asia/Seoul');
  assert.match(s.describe().timezone.note.en, /always shows the zone/);
  for (const [iso, want] of [['2026-11-12T00:05:00+09:00', '12:05 AM'], ['2026-11-12T12:00:00+09:00', '12:00 PM'], ['2026-11-12T23:59:00+09:00', '11:59 PM'], ['2026-11-12T09:00:00+09:00', '9:00 AM']]) {
    assert.match(displayDateTime(parseExactIso(iso)).en, new RegExp(`${want} \\(Seoul time, UTC\\+9\\)`));
  }
  // same instant given in UTC must display in the SAME explicit zone, not be reinterpreted silently
  assert.equal(variants.simulated().preview(intent({ when: { precision: 'exact', startIso: '2026-11-12T06:30:00Z', tz: 'Asia/Seoul' } })).display.when.en, p.display.when.en);
});

test('a different chosen time zone is shown, never silently reinterpreted', () => {
  const s = variants.local();
  const base = s.preview(intent());
  const ny = s.preview(intent({ when: { precision: 'exact', startIso: '2026-11-12T15:30:00+09:00', tz: 'America/New_York' } }));
  assert.equal(ny.fields.startsAt, base.fields.startsAt, 'the instant is unchanged');
  const w = ny.warnings.find((x) => x.code === 'timezone_differs');
  assert.ok(w);
  assert.match(w.message.en, /Your time zone is set to America\/New_York, but EBYS calendar entries are kept in Seoul time \(UTC\+9\)\./);
  assert.match(w.message.en, /Thu, 12 Nov 2026, 3:30 PM \(Seoul time, UTC\+9\)/);
  assert.equal(base.warnings.some((x) => x.code === 'timezone_differs'), false);
  // ICS: the phone shows it in its own zone, and the preview says so
  assert.ok(variants.ics().preview(intent()).warnings.some((x) => x.code === 'ics_local_timezone' && /phone's own time zone/.test(x.message.en)));
  assert.equal(variants.local().preview(intent()).warnings.some((x) => x.code === 'ics_local_timezone'), false);
});

test('clarification prompts are natural English and per situation; nothing is guessed or saved', async () => {
  const s = variants.local();
  const ask = (precision) => s.preview(intent({ when: { precision, tz: 'Asia/Seoul' } }));
  const amb = ask('ambiguous'); const dateOnly = ask('date_only'); const unk = ask('unknown');
  for (const p of [amb, dateOnly, unk]) { assert.equal(p.needs_clarification, true); assert.equal(p.previewDigest, undefined); }
  assert.equal(amb.prompt.en, "I'm not sure about the time yet. Please tell me the exact date and time, including AM or PM.");
  assert.equal(dateOnly.prompt.en, 'I have the date but not the time. What time should it be, and is that AM or PM?');
  assert.equal(unk.prompt.en, "I don't know when this is yet. What date and time should it be?");
  assert.equal(s.preview(intent({ title: ' ' })).prompt.en, 'What is this for?');
  const refused = await s.confirm({ intent: intent({ when: { precision: 'ambiguous', tz: 'Asia/Seoul' } }), previewDigest: 'x' });
  assert.equal(refused.error.code, 'needs_clarification'); assert.equal(refused.error.userHint.en, amb.prompt.en);
  assert.equal(s.list().length, 0);
  assert.equal(s._adapters.calendar.stats.executions, 0);
});

test('English cancel after a proposal blocks a stale confirm, with a clear English message and no side effect', async () => {
  const s = variants.local();
  const it = intent();
  const { previewDigest } = s.preview(it);
  const cancelled = await s.confirm({ intent: { ...it, proposalState: 'cancelled' }, previewDigest });
  assert.equal(cancelled.ok, false); assert.equal(cancelled.error.code, 'proposal_inactive');
  assert.equal(cancelled.error.userHint.en, 'This was cancelled or has expired, so nothing was done. Please start again if you still want it.');
  assert.equal(s.list().length, 0); assert.equal(s._adapters.calendar.stats.executions, 0);
  // an edited (newer) revision makes the old preview stale
  s.preview(intent({ revision: 2, title: 'Dental check-up (moved)' }));
  const stale = await s.confirm({ intent: it, previewDigest });
  assert.equal(stale.error.code, 'stale_preview');
  assert.equal(stale.error.userHint.en, 'Something changed since you last looked. Please review the details again.');
  assert.equal(s.list().length, 0);
});

test('capability labels are plain English and never claim the phone calendar or OS notifications for EBYS-local', () => {
  const local = variants.local().describe();
  assert.equal(local.calendar.kind, 'ebys_local');
  assert.match(local.calendar.name, /^EBYS calendar on this device/);
  assert.match(local.notifications.note, /not an OS or phone notification/);
  assert.equal(local.adapters[0].label.en, 'EBYS calendar on this device');
  assert.match(local.adapters[1].label.en, /not a real notification/);
  const txt = JSON.stringify([local, variants.local().preview(intent())]);
  assert.doesNotMatch(txt, /(?<!not (?:your |the )?)phone calendar/i);
  assert.match(variants.simulated().preview(intent()).modeLabel.en, /^Simulation only/);
  assert.match(variants.ics().preview(intent()).modeLabel.en, /^Calendar file:/);
  assert.match(variants.simulated().describe().calendar.name, /simulated/);
});

test('English end to end through the EBYS-local calendar: preview -> confirm -> readback -> reminder text', async () => {
  const proposal = { id: 'prop_en', revision: 1, state: 'user_confirmed', missing: [], slotUncertainty: { who: 'stated', when: 'stated' },
    evidence: [{ utteranceId: 'u1', charStart: 0, charEnd: 10, quote: 'Thursday at 3:30' }],
    fields: { kind: 'appointment', title: 'Dental check-up', who: 'Dr. Patel', startsAt: '2026-11-12T15:30:00+09:00', where: 'Maple Street Clinic', remindOffsetsMin: [60], sourceMemoryIds: ['m1'] } };
  const it = intentFromProposal(proposal, { sessionId: 'S' });
  const s = variants.local();
  const p = s.preview(it);
  assert.equal(p.summary.en, 'Dental check-up with Dr. Patel - Thu, 12 Nov 2026, 3:30 PM (Seoul time, UTC+9)');
  assert.equal(p.modeLabel.en, 'Saved to the EBYS calendar on this device (not your phone calendar)');
  const r = await s.confirm({ intent: it, previewDigest: p.previewDigest });
  assert.equal(r.status, 'completed'); assert.equal(r.verifyLevel, 'api_readback');
  assert.equal(r.readbackText.en, 'Saved in the EBYS calendar on this device and read back to check: Appointment: Dental check-up with Dr. Patel, Thu, 12 Nov 2026, 3:30 PM (Seoul time, UTC+9)');
  const due = s.dueNotifications('2026-11-12T14:30:00+09:00');
  assert.equal(due.notifications.length, 1);
  const nt = due.notifications[0];
  assert.equal(nt.title.en, '3:30 PM Dental check-up · Maple Street Clinic');
  assert.equal(nt.body.en, 'Starts in 1 hour · with Dr. Patel (Seoul time)');
  assert.equal(nt.label.en, 'EBYS reminder (shown inside the app, not a phone notification)');
  assert.doesNotMatch(JSON.stringify([nt.title.en, nt.body.en, nt.label.en]), HANGUL);
});

test('English error copy for the failure modes (exact wording, none of it reads as success)', async () => {
  const want = {
    permission_denied: 'Calendar permission was denied. Allow it in settings and try again. Nothing was sent.',
    network: 'No connection. Nothing was sent. Please try again.',
    timeout: "We didn't get an answer, so we can't tell whether it worked. Please check your calendar, and tap Check result before trying again.",
    api_500: "The server had a problem, so we can't tell whether it worked. Please check your calendar.",
    lost_response: 'The request went out, but no answer came back. Please check your calendar, and tap Check result before trying again.',
    readback_mismatch: "What was stored doesn't match what you asked for. Please don't rely on it.",
  };
  for (const fault of ['permission_denied', 'network', 'timeout', 'api_500', 'lost_response', 'mismatch']) {
    const r = await go(variants.local({ fault }), intent({ intentId: `x_${fault}` }));
    assert.equal(r.error.userHint.en, want[fault === 'mismatch' ? 'readback_mismatch' : fault], fault);
    assert.doesNotMatch(r.readbackText.en, /\b(saved|done|completed|success)/i, fault);
  }
  const corrupt = tmp(); writeFileSync(corrupt, 'oops');
  const c = await go(createActionService({ now: () => NOW, mode: 'real', calendarFile: corrupt }));
  assert.equal(c.error.userHint.en, 'The calendar file on this device looks damaged, so EBYS left it alone. Please ask for help.');
});
