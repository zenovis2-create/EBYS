import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIcs, parseIcs, icsToView, foldLine, escapeText, unescapeText, triggerFor } from './ics.mjs';
import { parseExactIso, toKstIso, displayDateTime } from './format.mjs';

const start = parseExactIso('2026-11-13T15:00:00+09:00');
const base = { uid: 'sj-abc@senior-jarvis.local', sequence: 0, title: 'Lunch, with Minsu; bring "list"', startMs: start, durationMin: 60, place: '한강 카페', who: 'Minsu', reminders: [1440, 60, 30], nowMs: parseExactIso('2026-11-09T10:30:00+09:00') };

test('ICS: structure, CRLF, UTC times, alarms', () => {
  const s = buildIcs(base);
  assert.ok(s.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(s.endsWith('END:VCALENDAR\r\n'));
  assert.ok(!/[^\r]\n/.test(s), 'every LF is preceded by CR');
  assert.match(s, /DTSTART:20261113T060000Z\r\n/); // 15:00 KST = 06:00Z
  assert.match(s, /DTEND:20261113T070000Z\r\n/);
  assert.match(s, /DTSTAMP:20261109T013000Z\r\n/);
  assert.match(s, /TRIGGER:-P1D\r\n/);
  assert.match(s, /TRIGGER:-PT1H\r\n/);
  assert.match(s, /TRIGGER:-PT30M\r\n/);
  assert.equal(triggerFor(90), '-PT90M');
});

test('ICS: only DISPLAY alarms; no attendee/organizer/url lines', () => {
  const s = buildIcs(base);
  const ev = parseIcs(s);
  assert.deepEqual([...new Set(ev.actions)], ['DISPLAY']);
  assert.ok(!/^(ATTENDEE|ORGANIZER|URL)[:;]/m.test(s));
  assert.ok(!/ACTION:(EMAIL|AUDIO|PROCEDURE)/.test(s));
});

test('ICS: lines are folded to <= 75 octets, Korean never split mid-character, round trip survives', () => {
  const long = { ...base, title: '병원 정기 검진과 상담 그리고 약 처방 확인 '.repeat(6), place: '서울특별시 종로구 세종대로 사거리 근처 건물 3층 '.repeat(4) };
  const s = buildIcs(long);
  for (const line of s.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75, `too long: ${line}`);
  const ev = parseIcs(s);
  assert.equal(ev.title, long.title);
  assert.equal(ev.place, long.place);
  assert.ok(!ev.title.includes('\ufffd'));
});

test('ICS: escaping and injection resistance', () => {
  assert.equal(unescapeText(escapeText('a,b;c\\d\ne')), 'a,b;c\\d\ne');
  // raw newlines in text fields are escaped, so they cannot start new properties
  const nl = buildIcs({ ...base, title: 'x\r\nBEGIN:VALARM\r\nACTION:EMAIL\r\nEND:VALARM' });
  assert.equal(parseIcs(nl).alarms.length, 3);
  assert.deepEqual([...new Set(parseIcs(nl).actions)], ['DISPLAY']);
});

test('ICS: view round trip matches inputs (payload-level readback)', () => {
  const v = icsToView(buildIcs(base));
  assert.equal(v.title, base.title);
  assert.equal(v.startsAt, '2026-11-13T15:00:00+09:00');
  assert.equal(v.where, base.place);
  assert.equal(v.who, 'Minsu');
  assert.deepEqual(v.reminders, [1440, 60, 30]);
  assert.equal(icsToView(buildIcs({ ...base, who: null, place: null })).who, null);
});

test('format: strict ISO parsing rejects rolled-over and partial dates', () => {
  assert.equal(parseExactIso('2026-02-31T10:00:00+09:00'), null);
  assert.equal(parseExactIso('2026-11-13'), null);
  assert.equal(parseExactIso('2026-11-13T15:00'), null); // no offset: not exact
  assert.equal(parseExactIso('2026-11-13T24:00:00+09:00'), null);
  assert.equal(parseExactIso('2026-11-13T15:00+09:00'), start);
  assert.equal(toKstIso(parseExactIso('2026-11-13T06:00:00Z')), '2026-11-13T15:00:00+09:00');
  const d = displayDateTime(start);
  assert.match(d.en, /Fri, 13 Nov 2026, 3:00 PM/);
  assert.match(d.ko, /2026년 11월 13일 \(금\) 오후 3:00/);
  assert.match(displayDateTime(parseExactIso('2026-11-13T00:05:00+09:00')).en, /12:05 AM/);
  assert.match(displayDateTime(parseExactIso('2026-11-13T12:00:00+09:00')).ko, /오후 12:00/);
});
