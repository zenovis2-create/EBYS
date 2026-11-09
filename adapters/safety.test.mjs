import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createActionService } from './action-service.mjs';
import { cleanText, containsForbiddenScheme } from './safety.mjs';
import { parseIcs } from './ics.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const tmpFile = () => join(mkdtempSync(join(tmpdir(), 'ebys-safety-')), 'calendar.json');
// 'simulated' | 'real-ics' | 'real-local'
const mk = (v) => createActionService({ now, mode: v === 'simulated' ? 'simulated' : 'real', real: v === 'real-ics' ? 'ics' : 'local', calendarFile: v === 'real-local' ? tmpFile() : undefined });
const now = () => '2026-11-09T10:30:00+09:00';
const intent = (o = {}) => ({
  intentId: 'p', revision: 1, kind: 'appointment', title: 'Clinic visit', person: { displayName: 'Dr. Han', speakerConfidence: 'confirmed' },
  when: { precision: 'exact', startIso: '2026-11-12T10:00:00+09:00', tz: 'Asia/Seoul' }, place: 'Seoul Clinic', reminderOffsetsMin: [60, 1440], sourceRefs: [], uncertainty: [], ...o,
});
const FORBIDDEN = /\b(tel|sms|smsto|mailto|callto|facetime|intent|sip)\s*:/i;

async function everyOutput(service, it) {
  const p = service.preview(it);
  const r = await service.confirm({ intent: it, previewDigest: p.previewDigest });
  const art = service.getArtifact(r.recordId);
  return JSON.stringify({ p, r, art, list: service.list(), info: service.describe() });
}

test('benign intents: no tel/sms/mailto/intent scheme and no 119 anywhere in any output, all adapters', async () => {
  for (const mode of ['simulated', 'real-ics', 'real-local']) {
    const out = await everyOutput(mk(mode), intent());
    assert.doesNotMatch(out, FORBIDDEN, mode);
    assert.doesNotMatch(out, /119/, mode);
  }
});

test('hostile text (links, newlines, injected properties) is neutralised in preview, record and ICS', async () => {
  const hostile = intent({
    title: 'Call tel:119 now\r\nBEGIN:VALARM\r\nACTION:EMAIL\r\nEND:VALARM',
    person: { displayName: 'x mailto:a@b.co sms:010', speakerConfidence: 'unknown' },
    place: 'TEL : 112 / intent://x#Intent;end',
  });
  for (const mode of ['simulated', 'real-ics', 'real-local']) {
    const s = mk(mode);
    const out = await everyOutput(s, hostile);
    assert.doesNotMatch(out, FORBIDDEN, mode);
    assert.equal(containsForbiddenScheme(cleanText('tel:119')), false);
    assert.equal(cleanText('hello\u0000 \n world'), 'hello world');
  }
  const s = mk('real-ics');
  const r = await s.confirm({ intent: hostile, previewDigest: s.preview(hostile).previewDigest });
  assert.equal(r.status, 'handed_off');
  const ics = s.getArtifact(r.recordId).content;
  const ev = parseIcs(ics);
  assert.equal(ev.alarms.length, 2, 'only our own two reminders; injected VALARM is plain text');
  assert.deepEqual([...new Set(ev.actions)], ['DISPLAY']);
  assert.ok(!/^(ATTENDEE|ORGANIZER|URL)[:;]/m.test(ics));
  // injected text may appear inside SUMMARY as plain text, but never as a property line of its own
  assert.ok(!/^ACTION:(EMAIL|AUDIO|PROCEDURE)/m.test(ics));
  assert.equal((ics.match(/^BEGIN:VALARM/gm) ?? []).length, 2);
});

test('local calendar file never stores a dial/message/mail scheme either', async () => {
  const file = tmpFile();
  const s = createActionService({ now, mode: 'real', calendarFile: file });
  const hostile = intent({ title: 'x tel:119 y', place: 'mailto:a@b.co', person: { displayName: 'sms:010', speakerConfidence: 'unknown' } });
  const r = await s.confirm({ intent: hostile, previewDigest: s.preview(hostile).previewDigest });
  assert.equal(r.status, 'completed');
  assert.ok(existsSync(file));
  assert.doesNotMatch(readFileSync(file, 'utf8'), FORBIDDEN);
});

test('generated ICS contains only expected property names (no communication or launch properties)', async () => {
  const s = mk('real-ics');
  const r = await s.confirm({ intent: intent(), previewDigest: s.preview(intent()).previewDigest });
  const names = new Set(s.getArtifact(r.recordId).content.split('\r\n').filter((l) => l && !l.startsWith(' ')).map((l) => l.split(/[:;]/)[0]));
  const allowed = new Set(['BEGIN', 'END', 'VERSION', 'PRODID', 'CALSCALE', 'METHOD', 'UID', 'DTSTAMP', 'DTSTART', 'DTEND', 'SEQUENCE', 'SUMMARY', 'LOCATION', 'DESCRIPTION', 'STATUS', 'ACTION', 'TRIGGER']);
  for (const n of names) assert.ok(allowed.has(n), `unexpected ICS property ${n}`);
});

test('static scan: adapter source files contain no dial/message/mail scheme, emergency number or network/process APIs', () => {
  const files = readdirSync(here).filter((f) => f.endsWith('.mjs') && !f.endsWith('.test.mjs'));
  assert.ok(files.length >= 8);
  for (const f of files) {
    const src = readFileSync(join(here, f), 'utf8');
    assert.doesNotMatch(src, FORBIDDEN, `${f} contains a forbidden link scheme`);
    assert.doesNotMatch(src, /\b119\b/, `${f} mentions an emergency number`);
    assert.doesNotMatch(src, /\b(fetch\s*\(|XMLHttpRequest|child_process|node:https?|node:net|spawn\s*\()/, `${f} uses network/process APIs`);
  }
});
