// Calendar panel (NEW module, standalone). English month + day view and the full saved-event list.
// Data comes ONLY from the `events` argument: the array stored by the EBYS local calendar (adapters/calendar-local.mjs,
// listEvents()). Nothing here is sample data. Text is only ever added as text nodes (see lib/dom.js).
// Times are the Asia/Seoul wall time stored in the file ("YYYY-MM-DDTHH:mm" == startsAt "...+09:00"). No Date/timezone
// conversion of wall times happens in the browser, so the device timezone can never shift an event.
import { h, append, clear } from '../lib/dom.js';

export const TZ = 'Asia/Seoul';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const TYPE_LABEL = { appointment: 'Appointment', deadline: 'Deadline', followup: 'Follow-up', reminder: 'Reminder' };
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const ISO_MIN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const pad = (n) => String(n).padStart(2, '0');

// ---------- pure helpers (exported for tests) ----------

/** Today's date in Seoul as YYYY-MM-DD, whatever the device timezone is. */
export function todayInSeoul(nowMs = Date.now()) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(nowMs));
  const g = (t) => p.find((x) => x.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}
/** Current Seoul wall time as YYYY-MM-DDTHH:mm. */
export function nowInSeoul(nowMs = Date.now()) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(nowMs));
  const g = (t) => p.find((x) => x.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`;
}

const parseDay = (s) => { const [y, m, d] = s.split('-').map(Number); return { y, m, d }; };
/** Day of week 0=Sunday for a calendar date (timezone independent). */
export const weekday = (s) => { const { y, m, d } = parseDay(s); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
export function addDays(s, n) {
  const { y, m, d } = parseDay(s);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
export function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}`;
}
export const isValidDay = (s) => typeof s === 'string' && ISO_DAY.test(s) && addDays(s, 0) === s;

/** "9:05 AM" from "HH:mm". */
export function time12(hhmm) {
  const [hh, mm] = hhmm.split(':').map(Number);
  return `${hh % 12 || 12}:${pad(mm)} ${hh >= 12 ? 'PM' : 'AM'}`;
}
export function dayLabel(s, { year = false } = {}) {
  const { y, m, d } = parseDay(s);
  return `${DOW[weekday(s)]}, ${MONTHS[m - 1]} ${d}${year ? `, ${y}` : ''}`;
}
export const monthLabel = (ym) => { const [y, m] = ym.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; };

/**
 * Normalise stored events. Wall time = `start` ("YYYY-MM-DDTHH:mm" or "YYYY-MM-DD" for all-day). When `startsAt` exists but
 * disagrees with `start`, the event is kept but flagged `unverified` (the store itself treats that as unreadable).
 * Events whose start cannot be read at all are returned in `invalid`, never silently dropped.
 */
export function normalizeEvents(events) {
  const ok = [];
  const invalid = [];
  for (const [i, e] of (Array.isArray(events) ? events : []).entries()) {
    const start = typeof e?.start === 'string' ? e.start : '';
    const allDay = ISO_DAY.test(start);
    const valid = typeof e?.title === 'string' && (allDay ? isValidDay(start) : ISO_MIN.test(start.slice(0, 16)) && isValidDay(start.slice(0, 10)));
    if (!valid) { invalid.push(e); continue; }
    const wall = allDay ? start : start.slice(0, 16);
    const end = !allDay && typeof e.end === 'string' && ISO_MIN.test(e.end.slice(0, 16)) ? e.end.slice(0, 16) : null;
    ok.push({
      raw: e,
      key: e.uid ?? e.id ?? `idx-${i}`,
      title: e.title,
      allDay,
      day: wall.slice(0, 10),
      time: allDay ? null : wall.slice(11, 16),
      endTime: end && end.slice(0, 10) === wall.slice(0, 10) ? end.slice(11, 16) : null,
      endDay: end && end.slice(0, 10) !== wall.slice(0, 10) ? end.slice(0, 10) : null,
      sortKey: allDay ? `${wall}T00:00` : wall,
      where: e.location || null,
      who: e.who || null,
      type: e.type && TYPE_LABEL[e.type] ? e.type : 'appointment',
      note: e.note || null,
      reminders: Array.isArray(e.reminders) ? e.reminders : [],
      unverified: typeof e.startsAt === 'string' && !allDay && e.startsAt.slice(0, 16) !== wall,
    });
  }
  ok.sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));
  return { events: ok, invalid };
}

export function eventsOnDay(list, day) { return list.filter((e) => e.day === day); }

/** 6 rows x 7 (Sunday first) of {day, inMonth, count}. `ym` = "YYYY-MM". Always 42 cells so the grid never jumps. */
export function buildMonthGrid(ym, list) {
  const first = `${ym}-01`;
  const start = addDays(first, -weekday(first));
  const counts = new Map();
  for (const e of list) counts.set(e.day, (counts.get(e.day) ?? 0) + 1);
  return Array.from({ length: 42 }, (_, i) => {
    const day = addDays(start, i);
    return { day, inMonth: day.slice(0, 7) === ym, count: counts.get(day) ?? 0 };
  });
}

/** Saved list: upcoming (from now, or all-day today onward) first, soonest first; then past, most recent first. */
export function splitSaved(list, nowWall) {
  const today = nowWall.slice(0, 10);
  const isUpcoming = (e) => (e.allDay ? e.day >= today : e.sortKey >= nowWall);
  return {
    upcoming: list.filter(isUpcoming),
    past: list.filter((e) => !isUpcoming(e)).reverse(),
  };
}

export function whenLabel(e) {
  if (e.allDay) return `${dayLabel(e.day, { year: true })} · All day`;
  const range = e.endTime ? `${time12(e.time)} to ${time12(e.endTime)}` : e.endDay ? `${time12(e.time)} to ${dayLabel(e.endDay)}` : time12(e.time);
  return `${dayLabel(e.day, { year: true })} · ${range}`;
}

// ---------- DOM ----------

/**
 * @param {{
 *   events: object[],                      // calendar.local events exactly as stored (see calendar-panel.READY.md)
 *   onRefresh?: () => (Promise|void),      // re-fetch events, then call panel.update(newEvents)
 *   onCreate?: (day: string) => void,      // "Add event" for the selected day (YYYY-MM-DD)
 *   onEdit?: (event: object) => void,      // raw stored event
 *   onDelete?: (event: object) => (Promise|void), // called only after the in-panel two-step confirmation
 *   now?: () => number,                    // test hook
 *   status?: string                        // optional line such as "Loaded from this device"
 * }} opts
 * @returns {HTMLElement} root; also has .update(events), .setError(msg|null), .setLoading(bool), .select(day)
 */
export function renderCalendarPanel({ events = [], onRefresh, onCreate, onEdit, onDelete, now = Date.now, status } = {}) {
  const st = { events: normalizeEvents(events), ym: null, sel: null, confirming: null, busy: false, error: null, loading: false, status: status ?? null };
  const today = () => todayInSeoul(now());
  st.sel = today();
  st.ym = st.sel.slice(0, 7);

  const root = h('section', { class: 'sjcal', 'aria-label': 'Calendar' });
  const live = h('p', { class: 'sjcal-live', role: 'status', 'aria-live': 'polite' });

  const btn = (label, onClick, { kind = '', aria, disabled } = {}) =>
    h('button', { type: 'button', class: `sjcal-btn ${kind}`.trim(), onclick: onClick, 'aria-label': aria, disabled }, label);

  function announce(msg) { live.textContent = msg; }

  async function run(fn, failMsg) {
    if (st.busy) return;
    st.busy = true; st.error = null; draw();
    try { await fn(); } catch (e) { st.error = `${failMsg} ${e?.message ? `(${e.message})` : ''}`.trim(); }
    st.busy = false; draw();
  }

  function eventRow(e, { showDay = false } = {}) {
    const confirming = st.confirming === e.key;
    const meta = [e.who && `With ${e.who}`, e.where && e.where, e.type !== 'appointment' && TYPE_LABEL[e.type]].filter(Boolean).join(' · ');
    return h('li', { class: 'sjcal-ev', dataset: { key: e.key } },
      h('div', { class: 'sjcal-ev-main' },
        h('p', { class: 'sjcal-ev-time' }, showDay ? whenLabel(e) : e.allDay ? 'All day' : e.endTime ? `${time12(e.time)} to ${time12(e.endTime)}` : time12(e.time)),
        h('p', { class: 'sjcal-ev-title' }, e.title),
        meta ? h('p', { class: 'sjcal-ev-meta' }, meta) : null,
        e.unverified ? h('p', { class: 'sjcal-warn' }, 'The saved time does not match its record. Check it before relying on it.') : null),
      (onEdit || onDelete) ? (confirming
        ? h('div', { class: 'sjcal-ev-actions', role: 'group', 'aria-label': `Delete ${e.title}?` },
          h('p', { class: 'sjcal-ask' }, `Delete "${e.title}"?`),
          btn('Yes, delete', () => run(async () => { await onDelete(e.raw); st.confirming = null; announce('Event deleted.'); }, 'Could not delete the event.'), { kind: 'danger', disabled: st.busy }),
          btn('Keep it', () => { st.confirming = null; draw(); }, { disabled: st.busy }))
        : h('div', { class: 'sjcal-ev-actions' },
          onEdit ? btn('Edit', () => onEdit(e.raw), { aria: `Edit ${e.title}` }) : null,
          onDelete ? btn('Delete', () => { st.confirming = e.key; draw(); }, { kind: 'quiet', aria: `Delete ${e.title}` }) : null)) : null);
  }

  function monthSection() {
    const cells = buildMonthGrid(st.ym, st.events.events);
    const t = today();
    return h('div', { class: 'sjcal-month' },
      h('div', { class: 'sjcal-nav' },
        btn('‹ Prev', () => { st.ym = addMonths(st.ym, -1); draw(); }, { aria: 'Previous month' }),
        h('h2', { class: 'sjcal-month-title', 'aria-live': 'polite' }, monthLabel(st.ym)),
        btn('Next ›', () => { st.ym = addMonths(st.ym, 1); draw(); }, { aria: 'Next month' })),
      h('div', { class: 'sjcal-grid', role: 'table', 'aria-label': `${monthLabel(st.ym)}, days with saved events are marked` },
        h('div', { class: 'sjcal-row', role: 'row' }, DOW_SHORT.map((d, i) => h('div', { class: 'sjcal-dow', role: 'columnheader', 'aria-label': DOW[i] }, d))),
        Array.from({ length: 6 }, (_, r) => h('div', { class: 'sjcal-row', role: 'row' },
          cells.slice(r * 7, r * 7 + 7).map((c) => h('div', {
            class: `sjcal-cell${c.inMonth ? '' : ' out'}${c.day === t ? ' today' : ''}${c.day === st.sel ? ' sel' : ''}${c.count ? ' has' : ''}`,
            role: 'cell',
            'aria-label': `${dayLabel(c.day)}${c.day === t ? ', today' : ''}${c.count ? `, ${c.count} event${c.count > 1 ? 's' : ''}` : ''}`,
          }, h('span', { class: 'sjcal-num', 'aria-hidden': 'true' }, String(Number(c.day.slice(8)))),
          c.count ? h('span', { class: 'sjcal-dot', 'aria-hidden': 'true' }, c.count > 9 ? '9+' : String(c.count)) : null))))),
      h('p', { class: 'sjcal-hint' }, 'Numbers show how many events a day has. Choose a day below to see it.'));
  }

  function daySection() {
    const t = today();
    const dayEvents = eventsOnDay(st.events.events, st.sel);
    const dateInput = h('input', {
      type: 'date', class: 'sjcal-date', value: st.sel, 'aria-label': 'Go to a date',
      onchange: (ev) => { const v = ev.target.value; if (isValidDay(v)) { st.sel = v; st.ym = v.slice(0, 7); draw(); } },
    });
    return h('div', { class: 'sjcal-day' },
      h('div', { class: 'sjcal-nav' },
        btn('‹ Day', () => { st.sel = addDays(st.sel, -1); st.ym = st.sel.slice(0, 7); draw(); }, { aria: 'Previous day' }),
        h('h2', { class: 'sjcal-day-title' }, dayLabel(st.sel), st.sel === t ? h('span', { class: 'sjcal-badge' }, 'Today') : null),
        btn('Day ›', () => { st.sel = addDays(st.sel, 1); st.ym = st.sel.slice(0, 7); draw(); }, { aria: 'Next day' })),
      h('div', { class: 'sjcal-tools' },
        btn('Today', () => { st.sel = t; st.ym = t.slice(0, 7); draw(); }, { disabled: st.sel === t }),
        h('label', { class: 'sjcal-datelabel' }, h('span', {}, 'Go to date'), dateInput),
        onCreate ? btn('+ Add event', () => onCreate(st.sel), { kind: 'primary', aria: `Add event on ${dayLabel(st.sel)}` }) : null),
      dayEvents.length
        ? h('ul', { class: 'sjcal-list', 'aria-label': `Events on ${dayLabel(st.sel)}` }, dayEvents.map((e) => eventRow(e)))
        : h('p', { class: 'sjcal-empty' }, `No events on ${dayLabel(st.sel)}.`));
  }

  function savedSection() {
    const { upcoming, past } = splitSaved(st.events.events, nowInSeoul(now()));
    const total = st.events.events.length;
    const group = (title, list, empty) => h('div', { class: 'sjcal-group' },
      h('h3', { class: 'sjcal-h3' }, `${title} (${list.length})`),
      list.length ? h('ul', { class: 'sjcal-list' }, list.map((e) => eventRow(e, { showDay: true }))) : h('p', { class: 'sjcal-empty' }, empty));
    return h('div', { class: 'sjcal-saved' },
      h('h2', { class: 'sjcal-h2' }, `Saved events (${total})`),
      total === 0 ? h('p', { class: 'sjcal-empty' }, 'Nothing is saved on this calendar yet. Events you confirm will appear here.') : null,
      total ? [group('Upcoming', upcoming, 'No upcoming events.'), group('Past', past, 'No past events.')] : null,
      st.events.invalid.length ? h('p', { class: 'sjcal-warn' }, `${st.events.invalid.length} saved entr${st.events.invalid.length > 1 ? 'ies have' : 'y has'} no readable date and cannot be shown.`) : null);
  }

  function draw() {
    // Keep keyboard focus on the same control across redraws.
    const active = document.activeElement;
    const focusKey = root.contains(active) ? (active.getAttribute?.('aria-label') ?? active.textContent) : null;
    clear(root);
    append(root, [
      h('header', { class: 'sjcal-head' },
        h('div', {},
          h('h1', { class: 'sjcal-h1' }, 'Calendar'),
          h('p', { class: 'sjcal-source' }, `EBYS calendar on this device · ${TZ} time${st.status ? ` · ${st.status}` : ''}`)),
        onRefresh ? btn(st.loading ? 'Refreshing…' : 'Refresh', () => run(async () => { st.loading = true; try { await onRefresh(); } finally { st.loading = false; } announce('Calendar refreshed.'); }, 'Could not refresh the calendar.'), { disabled: st.busy || st.loading }) : null),
      st.error ? h('p', { class: 'sjcal-error', role: 'alert' }, st.error) : null,
      monthSection(), daySection(), savedSection(), live]);
    if (focusKey) {
      const again = [...root.querySelectorAll?.('button,input') ?? []].find((n) => (n.getAttribute('aria-label') ?? n.textContent) === focusKey && !n.disabled);
      again?.focus?.();
    }
  }

  root.update = (next) => { st.events = normalizeEvents(next); st.confirming = null; draw(); };
  root.setError = (msg) => { st.error = msg || null; draw(); };
  root.setLoading = (v) => { st.loading = !!v; draw(); };
  root.select = (day) => { if (isValidDay(day)) { st.sel = day; st.ym = day.slice(0, 7); draw(); } };
  draw();
  return root;
}
