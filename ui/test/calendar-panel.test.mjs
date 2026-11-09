// Calendar panel tests (no browser, no install): pure logic + render through a tiny fake DOM.
// Run: node --test ui/test/calendar-panel.test.mjs
// Fixture events use the exact shape adapters/calendar-local.mjs stores. They are TEST DATA only; the panel ships with none.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---- minimal fake DOM (enough for lib/dom.js + the panel) ----
class FNode {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.listeners = {}; this.dataset = {}; this.className = ''; this.parent = null; this.disabled = false; this._text = ''; }
  append(...kids) { for (const k of kids) { const n = typeof k === 'string' ? Object.assign(new FNode('#text'), { _text: k }) : k; n.parent = this; this.children.push(n); } }
  get firstChild() { return this.children[0] ?? null; }
  removeChild(c) { this.children.splice(this.children.indexOf(c), 1); return c; }
  setAttribute(k, v) { this.attrs[k] = v; if (k === 'disabled') this.disabled = true; }
  getAttribute(k) { return this.attrs[k] ?? null; }
  addEventListener(t, fn) { (this.listeners[t] ??= []).push(fn); }
  contains(n) { for (let c = n; c; c = c.parent) if (c === this) return true; return false; }
  focus() { globalThis.document.activeElement = this; }
  get textContent() { return this.tag === '#text' ? this._text : this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { this.children = []; this.append(String(v)); }
  walk(out = []) { out.push(this); this.children.forEach((c) => c.walk(out)); return out; }
  querySelectorAll(sel) { const tags = sel.split(','); return this.walk().filter((n) => tags.includes(n.tag) && n !== this); }
  click() { (this.listeners.click ?? []).forEach((f) => f({ target: this })); }
}
globalThis.Node = FNode;
globalThis.document = { activeElement: null, createElement: (t) => new FNode(t), createTextNode: (s) => Object.assign(new FNode('#text'), { _text: s }) };

const m = await import('../modules/calendar-panel.js');
const { renderCalendarPanel, normalizeEvents, buildMonthGrid, splitSaved, todayInSeoul, weekday, addDays, addMonths, time12 } = m;

const ev = (o) => ({ id: 'x', uid: `u-${o.title}`, type: 'appointment', ...o });
const SAVED = [
  ev({ title: 'Dr. Kim checkup', start: '2026-11-12T15:00', end: '2026-11-12T16:00', startsAt: '2026-11-12T15:00:00+09:00', location: 'Clinic', who: 'Dr. Kim' }),
  ev({ title: 'Old visit', start: '2026-10-01T09:30', startsAt: '2026-10-01T09:30:00+09:00' }),
  ev({ title: 'Birthday', start: '2026-11-20', allDay: true }),
  ev({ title: 'Later one', start: '2026-11-12T08:05', startsAt: '2026-11-12T08:05:00+09:00' }),
];
const NOW = Date.parse('2026-11-09T14:33:00+09:00');

const texts = (root, cls) => root.walk().filter((n) => (n.className || '').split(' ').includes(cls)).map((n) => n.textContent);
const buttons = (root, label) => root.querySelectorAll('button').filter((b) => b.textContent === label);

test('weekday/addDays/addMonths are timezone independent and correct', () => {
  assert.equal(weekday('2026-11-09'), 1); // Monday
  assert.equal(addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addMonths('2026-12', 1), '2027-01');
  assert.equal(addMonths('2026-01', -1), '2025-12');
  assert.equal(time12('00:05'), '12:05 AM');
  assert.equal(time12('15:00'), '3:00 PM');
});

test('today is computed in Asia/Seoul, not the device zone', () => {
  assert.equal(todayInSeoul(Date.parse('2026-11-09T15:30:00Z')), '2026-11-10'); // 00:30 KST next day
  assert.equal(todayInSeoul(Date.parse('2026-11-09T14:59:00Z')), '2026-11-09');
});

test('normalizeEvents sorts, keeps all-day, and reports unreadable entries instead of dropping them', () => {
  const { events, invalid } = normalizeEvents([...SAVED, { title: 'bad', start: 'tomorrow' }, null, { start: '2026-11-01T10:00' }, { title: 'x', start: '2026-02-31' }]);
  assert.deepEqual(events.map((e) => e.title), ['Old visit', 'Later one', 'Dr. Kim checkup', 'Birthday']);
  assert.equal(invalid.length, 4);
  assert.equal(events.find((e) => e.title === 'Birthday').allDay, true);
  assert.equal(events.find((e) => e.title === 'Dr. Kim checkup').endTime, '16:00');
  assert.equal(normalizeEvents(undefined).events.length, 0);
});

test('mismatched startsAt is flagged, not hidden', () => {
  const { events } = normalizeEvents([ev({ title: 'Odd', start: '2026-11-12T15:00', startsAt: '2026-11-12T16:00:00+09:00' })]);
  assert.equal(events[0].unverified, true);
});

test('month grid is always 42 cells, Sunday first, with per-day counts', () => {
  const g = buildMonthGrid('2026-11', normalizeEvents(SAVED).events);
  assert.equal(g.length, 42);
  assert.equal(g[0].day, '2026-11-01'); // Nov 1 2026 is a Sunday
  assert.equal(g.find((c) => c.day === '2026-11-12').count, 2);
  assert.equal(g.find((c) => c.day === '2026-11-20').count, 1);
  assert.ok(g.find((c) => c.day === '2026-12-01' && !c.inMonth));
  assert.equal(buildMonthGrid('2026-02', []).length, 42);
});

test('saved split: upcoming soonest first, past most recent first; all-day today stays upcoming', () => {
  const { events } = normalizeEvents([...SAVED, ev({ title: 'All day today', start: '2026-11-09' })]);
  const { upcoming, past } = splitSaved(events, '2026-11-09T14:33');
  assert.deepEqual(upcoming.map((e) => e.title), ['All day today', 'Later one', 'Dr. Kim checkup', 'Birthday']);
  assert.deepEqual(past.map((e) => e.title), ['Old visit']);
});

test('renders saved list with every stored event even when the current month is empty', () => {
  const far = [ev({ title: 'Spring checkup', start: '2027-03-04T10:00', startsAt: '2027-03-04T10:00:00+09:00' })];
  const root = renderCalendarPanel({ events: far, now: () => NOW });
  assert.match(root.textContent, /Saved events \(1\)/);
  assert.match(root.textContent, /Spring checkup/);
  assert.match(root.textContent, /Thursday, March 4, 2027 · 10:00 AM/);
  assert.match(root.textContent, /No events on Monday, November 9\./);
  assert.match(root.textContent, /November 2026/);
});

test('truly empty calendar shows an honest empty state, no invented appointments', () => {
  const root = renderCalendarPanel({ events: [], now: () => NOW });
  assert.match(root.textContent, /Saved events \(0\)/);
  assert.match(root.textContent, /Nothing is saved on this calendar yet/);
  assert.equal(root.walk().filter((n) => n.className === 'sjcal-ev').length, 0);
});

test('English-only labels, Seoul time, 12-hour times', () => {
  const root = renderCalendarPanel({ events: SAVED, now: () => NOW });
  const t = root.textContent;
  assert.match(t, /Asia\/Seoul time/);
  assert.match(t, /3:00 PM to 4:00 PM/);
  assert.match(t, /8:05 AM/);
  assert.match(t, /Friday, November 20, 2026 · All day/);
  assert.doesNotMatch(t, /[\u3131-\uD79D]/); // no Hangul
});

test('day navigation, today, month navigation and select()', () => {
  const root = renderCalendarPanel({ events: SAVED, now: () => NOW });
  buttons(root, 'Next ›')[0].click();
  assert.match(root.textContent, /December 2026/);
  buttons(root, '‹ Prev')[0].click();
  buttons(root, '‹ Prev')[0].click();
  assert.match(root.textContent, /October 2026/);
  root.select('2026-11-12');
  assert.match(root.textContent, /Thursday, November 12/);
  const dayList = root.walk().find((n) => n.attrs['aria-label'] === 'Events on Thursday, November 12');
  assert.equal(dayList.children.length, 2);
  buttons(root, 'Today')[0].click();
  assert.match(root.textContent, /Monday, November 9/);
  buttons(root, 'Day ›')[0].click();
  assert.match(root.textContent, /Tuesday, November 10/);
});

test('callbacks: create gets the selected day, edit gets the raw stored event, delete needs confirmation first', async () => {
  const calls = [];
  let current = SAVED;
  const root = renderCalendarPanel({
    events: SAVED, now: () => NOW,
    onCreate: (d) => calls.push(['create', d]),
    onEdit: (e) => calls.push(['edit', e.uid]),
    onDelete: async (e) => { calls.push(['delete', e.uid]); current = current.filter((x) => x.uid !== e.uid); root.update(current); },
    onRefresh: async () => { calls.push(['refresh']); root.update(current); },
  });
  root.select('2026-11-12');
  buttons(root, '+ Add event')[0].click();
  buttons(root, 'Edit')[0].click();
  assert.deepEqual(calls, [['create', '2026-11-12'], ['edit', 'u-Later one']]);

  buttons(root, 'Delete')[0].click();
  assert.equal(calls.length, 2, 'first click must only ask');
  assert.match(root.textContent, /Delete "Later one"\?/);
  buttons(root, 'Keep it')[0].click();
  assert.doesNotMatch(root.textContent, /Delete "Later one"\?/);

  buttons(root, 'Delete')[0].click();
  buttons(root, 'Yes, delete')[0].click();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(calls.at(-1), ['delete', 'u-Later one']);
  assert.match(root.textContent, /Saved events \(3\)/);
  assert.doesNotMatch(root.textContent, /Later one/);

  buttons(root, 'Refresh')[0].click();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(calls.at(-1), ['refresh']);
});

test('a failing delete or refresh shows an alert and keeps the event', async () => {
  const root = renderCalendarPanel({ events: SAVED, now: () => NOW, onDelete: async () => { throw new Error('disk full'); }, onRefresh: async () => { throw new Error('offline'); } });
  root.select('2026-11-12');
  buttons(root, 'Delete')[0].click();
  buttons(root, 'Yes, delete')[0].click();
  await new Promise((r) => setTimeout(r, 0));
  assert.match(texts(root, 'sjcal-error')[0], /Could not delete the event\. \(disk full\)/);
  assert.match(root.textContent, /Later one/);
  buttons(root, 'Refresh')[0].click();
  await new Promise((r) => setTimeout(r, 0));
  assert.match(texts(root, 'sjcal-error')[0], /Could not refresh the calendar\. \(offline\)/);
});

test('buttons for absent callbacks are not rendered', () => {
  const root = renderCalendarPanel({ events: SAVED, now: () => NOW });
  for (const l of ['Edit', 'Delete', '+ Add event', 'Refresh']) assert.equal(buttons(root, l).length, 0, l);
});

test('hostile text stays text (no innerHTML anywhere)', () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../modules/calendar-panel.js'), 'utf8');
  assert.doesNotMatch(src.replace(/\/\/.*$/gm, ''), /innerHTML|outerHTML|insertAdjacentHTML|navigator\.language|calendar\.json/);
  const root = renderCalendarPanel({ events: [ev({ title: '<img src=x onerror=alert(1)>', start: '2026-11-09T09:00' })], now: () => NOW });
  assert.ok(root.textContent.includes('<img src=x onerror=alert(1)>'));
  assert.equal(root.walk().filter((n) => n.tag === 'img').length, 0);
});

test('CSS is scoped to .sjcal and senior-sized', () => {
  const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../modules/calendar-panel.css'), 'utf8');
  const selectors = css.replace(/\/\*[\s\S]*?\*\//g, '').split('}').map((b) => b.split('{')[0].trim()).filter((s) => s && !s.startsWith('@'));
  for (const s of selectors) for (const part of s.split(',')) assert.match(part.trim(), /^\.sjcal/, `unscoped selector: ${part}`);
  assert.match(css, /--c-tap: 3\.5rem/);
});
