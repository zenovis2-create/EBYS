// Calendar-time safety: a target LINK from a follow-up / related action must never revise the parent's time (live bug, 2:30 PM -> 2:00 PM).
// Raw shape copied from evidence/lead-calendar-local-2026-11-09T04-12-15-270Z.json (live model), FAKE llm only proves the code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCore } from './core.mjs';
import { mergeParts, parseTimePhrase } from './time.mjs';
import { fakeLlm, item, NOW } from './testkit.mjs';

const EYE = [
  'Daniel: Mom, I booked your eye check at Riverside Clinic for Thursday, November 12 at 2:30 PM.',
  'Mom: Thursday the 12th at 2:30 in the afternoon. Will you drive me?',
  'Daniel: Yes, I will pick you up at 2.',
].join('\n');
const eyeItems = () => [
  { ...item({ ref: 'm1', quote: 'I booked your eye check at Riverside Clinic for Thursday, November 12 at 2:30 PM', u: 0, title: { ko: '리버사이드 클리닉 눈 검사', en: 'Eye check at Riverside Clinic' }, who: [['Daniel', 0, 'Daniel']], when: [[0, 'Thursday, November 12 at 2:30 PM']], where: ['Riverside Clinic', 0] }), type: 'appointment', confidence: 0.9 },
  { ...item({ ref: 'm2', cue: 'agree', quote: 'Thursday the 12th at 2:30 in the afternoon', u: 1, title: { ko: '리버사이드 클리닉 눈 검사 확인', en: 'Eye check confirmed for Thursday the 12th' }, when: [[1, 'Thursday the 12th at 2:30 in the afternoon']], target: 'm1' }), type: 'appointment', confidence: 0.85 },
  { ...item({ ref: 'm3', quote: 'I will pick you up at 2', u: 2, title: { ko: '다니엘이 2시에 태우러 오기', en: 'Daniel picks Mom up' }, who: [['Daniel', 2, 'Daniel']], when: [[2, 'at 2']], target: 'm1' }), type: 'followup', question: 'Is the pickup at 2 PM on Thursday, November 12?', confidence: 0.7 },
  { ...item({ ref: 'm4', kind: 'task', cue: 'none', quote: 'I will pick you up at 2', u: 2, title: { ko: '다니엘이 병원까지 태워주기', en: 'Daniel drives Mom to the clinic' }, who: [['Daniel', 2, 'Daniel']], when: [[2, 'at 2']], what: ['Pick Mom up for the eye check', 2, 'I will pick you up at 2'], target: 'm3' }), owner: 'other', confidence: 0.7 },
];
const mk = (items) => createCore({ now: () => NOW, llm: fakeLlm({ extract: () => ({ items }) }) });

test('a followup/pickup item linked to the appointment stays separate; the appointment keeps 14:30', async () => {
  const core = mk(eyeItems());
  const r = await core.ingestText({ title: 'eye check', text: EYE });
  assert.equal(r.ok, true);
  const mems = core.listMemories({ includeSuperseded: true });
  const appt = mems.find((m) => /Eye check/.test(m.summary.en));
  assert.equal(appt.when.value.date, '2026-11-12');
  assert.equal(appt.when.value.time, '14:30', 'minutes must survive');
  assert.equal(appt.when.value.startIso.startsWith('2026-11-12T14:30'), true);
  assert.ok(!(appt.when.value.flags ?? []).includes('time_conflict'));
  assert.equal(appt.when.state, 'known');
  // the "at 2" evidence is not on the appointment's when
  assert.ok(!appt.when.evidence.some((e) => /^at 2$/.test(e.quote)), JSON.stringify(appt.when.evidence.map((e) => e.quote)));
  assert.equal(appt.status, 'candidate');
  // the pickup is its own memory, linked by nothing that changes the appointment
  const pick = mems.find((m) => m.kind === 'event' && /picks Mom up/.test(m.summary.en));
  assert.ok(pick && pick.id !== appt.id);
  assert.notEqual(pick.when.value?.time, '14:00', 'a bare "at 2" is never silently resolved to 2 PM');
  assert.ok(!r.merged.includes(pick.id));
  // the agree restatement (same time) still corroborates the appointment
  assert.ok(appt.evidence.some((e) => /2:30 in the afternoon/.test(e.quote)));
  assert.ok(appt.meta.corroborations >= 2);
});

test('same raw shape through core.propose: the proposed start is 14:30, never 14:00', async () => {
  const core = mk(eyeItems());
  await core.ingestText({ title: 'eye check', text: EYE });
  const appt = core.listMemories().find((m) => /Eye check/.test(m.summary.en));
  const p = core.propose(appt.id);
  assert.equal(p.fields.startsAt.startsWith('2026-11-12T14:30'), true, p.fields.startsAt);
  assert.equal(appt.when.value.time, '14:30');
});

test('an agree item that states a DIFFERENT clock time does not rewrite the parent (conflict is flagged, user decides)', async () => {
  const items = eyeItems().slice(0, 1);
  items.push({ ...item({ ref: 'm2', cue: 'agree', quote: 'Thursday the 12th at 3 in the afternoon', u: 1, title: { ko: '눈 검사 확인', en: 'Eye check confirmed' }, when: [[1, 'Thursday the 12th at 3 in the afternoon']], target: 'm1' }), type: 'appointment' });
  const text = EYE.replace('2:30 in the afternoon', '3 in the afternoon');
  const core = mk(items);
  await core.ingestText({ title: 'eye check', text });
  const first = core.listMemories({ includeSuperseded: true }).find((m) => m.evidence.some((e) => /2:30 PM/.test(e.quote)));
  assert.equal(first.when.value.time, '14:30');
  assert.equal(first.when.uncertainty, 'conflicting');
});

test('mergeParts: a later different or ambiguous clock time never overwrites a resolved one (flagged time_conflict)', () => {
  const NOWI = NOW;
  const a = parseTimePhrase('Thursday, November 12 at 2:30 PM', NOWI);
  const b = parseTimePhrase('at 2', NOWI);
  const c = parseTimePhrase('Thursday the 12th at 2:30 in the afternoon', NOWI);
  const m = mergeParts([a, b]);
  assert.equal(m.time, '14:30'); assert.ok(m.flags.includes('time_conflict'));
  assert.equal(mergeParts([a, c]).time, '14:30'); assert.ok(!mergeParts([a, c]).flags.includes('time_conflict'));
  // ambiguous first, resolved later: still resolves (unchanged behaviour)
  assert.equal(mergeParts([b, a]).time, '14:30');
});