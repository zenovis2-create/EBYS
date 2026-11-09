import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTimePhrase as p, mergeParts, buildWhenSlot, scanTimePhrases } from './time.mjs';

const MON = '2026-11-09T10:30:00+09:00'; // Monday, Asia/Seoul

const slot = (phrase, anchor = MON) => buildWhenSlot([p(phrase, anchor)]);

test('KO relative week + weekday + explicit PM resolves exactly', () => {
  const s = slot('다음 주 화요일 오후 세 시');
  assert.equal(s.state, 'known');
  assert.equal(s.value.startIso, '2026-11-17T15:00:00+09:00');
});

test('R05: bare hour without AM/PM is ambiguous and never defaulted (KO and EN)', () => {
  for (const ph of ['내일 두 시', '화요일 세 시 반', 'Tuesday at 3', 'tomorrow at 2']) {
    const s = slot(ph);
    assert.equal(s.state, 'ambiguous', ph);
    assert.equal(s.value.startIso, null, ph);
    assert.ok(s.clarification.ko && s.clarification.en, ph);
    assert.ok(s.candidates.length >= 2, ph);
  }
  const s = slot('내일 두 시');
  assert.deepEqual(new Set(s.candidates.map((c) => c.time)), new Set(['14:00', '02:00']));
});

test('daypart words resolve the hour, but marked inferred', () => {
  assert.equal(slot('내일 저녁 여섯 시').value.startIso, '2026-11-10T18:00:00+09:00');
  assert.equal(slot('내일 아침 7시').value.startIso, '2026-11-10T07:00:00+09:00');
  const s = slot('tomorrow evening at 6');
  assert.equal(s.value.startIso, '2026-11-10T18:00:00+09:00');
  assert.equal(s.uncertainty, 'inferred');
});

test('merging parts: lunch daypart + bare 12:30 => 12:30 (same memory), alone => ambiguous', () => {
  const merged = buildWhenSlot([p('토요일 점심은', MON), p('열두 시 반', MON)]);
  assert.equal(merged.value.startIso, '2026-11-14T12:30:00+09:00');
  const alone = buildWhenSlot([p('토요일 열두 시 반', MON)]);
  assert.equal(alone.state, 'ambiguous');
});

test('EN next <weekday> is ambiguous when that weekday is still ahead this week', () => {
  const s = slot('next Friday');
  assert.equal(s.state, 'ambiguous');
  assert.deepEqual(s.candidates.map((c) => c.date), ['2026-11-13', '2026-11-20']);
  const tue = slot('next Monday', '2026-11-10T09:00:00+09:00');
  assert.equal(tue.value.date, '2026-11-16');
});

test('bare weekday = next occurrence; same weekday is ambiguous; weekend is a range', () => {
  assert.equal(p('금요일', MON).date, '2026-11-13');
  assert.equal(p('Friday', MON).date, '2026-11-13');
  assert.equal(slot('월요일 3pm').state, 'ambiguous');
  const w = slot('이번 주말');
  assert.equal(w.state, 'ambiguous');
  assert.deepEqual(w.candidates.map((c) => c.date), ['2026-11-14', '2026-11-15']);
});

test('absolute dates, year roll-over and day-of-month', () => {
  assert.equal(p('11월 20일 오후 3시 30분', MON).date, '2026-11-20');
  assert.equal(slot('11월 20일 오후 3시 30분').value.startIso, '2026-11-20T15:30:00+09:00');
  const past = p('3월 2일', MON);
  assert.equal(past.date, '2027-03-02');
  assert.ok(past.flags.includes('past_date_rolled'));
  assert.equal(p('Nov 20 at 3pm', MON).time, '15:00');
  assert.equal(p('20일', MON).date, '2026-11-20');
});

test('late-night "tomorrow" is ambiguous (00:40 on Nov 10)', () => {
  const s = slot('내일 보자', '2026-11-10T00:40:00+09:00');
  assert.equal(s.state, 'ambiguous');
  assert.deepEqual(s.candidates.map((c) => c.date), ['2026-11-10', '2026-11-11']);
});

test('vague or unsupported phrases never produce a date', () => {
  for (const ph of ['한 시간 뒤', '추석', '다음에 보자', '']) {
    const r = p(ph, MON);
    assert.equal(r.date, null, ph); assert.equal(r.time, null, ph);
  }
  assert.equal(buildWhenSlot([p('추석', MON)]).state, 'unknown');
});

test('Korean native numerals incl. 열두 시 and 한 시 vs 한 시간', () => {
  assert.equal(p('오후 열두 시', MON).time, '12:00');
  assert.equal(p('오후 한 시', MON).time, '13:00');
  assert.equal(p('한 시간', MON).time, null);
  assert.equal(p('15시 30분', MON).time, '15:30');
});

test('scanTimePhrases (fallback) merges date + time phrases and keeps offsets', () => {
  const t = '다음 주 화요일 오후 세 시에 만나요';
  const spans = scanTimePhrases(t);
  assert.equal(spans.length, 1);
  assert.equal(t.slice(spans[0].start, spans[0].end), spans[0].text);
  assert.ok(spans[0].text.includes('화요일') && spans[0].text.includes('세 시'));
});
