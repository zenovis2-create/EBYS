// calendar.local: a REAL local EBYS calendar stored in one JSON file on this device (default senior-jarvis/.data/calendar.json).
// It is NOT the phone's calendar and NOT a cloud account. Readback re-reads the file from disk.
// Server-side only (node:fs). Owner: sj-actions.
//
// ADAPTED from E:\jarvis-aside-bridge\server.js (read-only source, sha256 1D0FB4BB59C51B2B903C4AC279071027622EC2CF52F4976B70296BE4FC5DCFAA),
// lines 478-547: readCal/writeCal (atomic tmp+rename, mode 0o600), cleanEvent, cleanTask, calAddEvent/calAddTask, calReminderSweep.
// Changes vs the source (all deliberate):
//  - Store keeps a source label only, never transcript text (same rule as source), and adds uid/intentId/revision/sessionId/who/reminders.
//  - Corrupt or unreadable file is an error (the source silently starts an empty calendar, which would overwrite the user's data on next write).
//  - fs failures map to phase-aware AdapterErrors (permission_denied / storage_error, both pre_send).
//  - Upsert by stable uid (idempotent across revisions and across server restarts) instead of always appending.
//  - Times are fixed Asia/Seoul (+09:00); the source used the machine's local timezone.
//  - Reminder sweep keeps the source rules (30 min before timed events, 08:00 for all-day, 09:00 for tasks due today) but honours the
//    reminder offsets the user confirmed; the default is 30 min only when none were chosen. After downtime only the nearest due
//    reminder per event is emitted (older ones are marked done, not spammed).
//  - Sweep returns notification objects that are also persisted in the file (poll with a sequence number) instead of an in-memory SSE ring.
//  - The source's task-run/Aside bridge coupling (startTaskRun, calSyncRuns, pushEvent, audit) is NOT carried over.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { AdapterError } from './calendar-adapters.mjs';
import { parseExactIso, toKstIso, displayParts } from './format.mjs';

/** 1440 -> '1 day', 60 -> '1 hour', 90 -> '90 minutes' (plain English for the reminder body). */
function humanMinutes(min) {
  if (min % 1440 === 0) { const n = min / 1440; return `${n} day${n > 1 ? 's' : ''}`; }
  if (min % 60 === 0) { const n = min / 60; return `${n} hour${n > 1 ? 's' : ''}`; }
  return `${min} minute${min > 1 ? 's' : ''}`;
}

const ISO_MIN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const EVENT_TYPES = ['appointment', 'deadline', 'followup', 'reminder'];
const DEFAULT_OFFSETS = [30];
const MAX_NOTIFICATIONS = 200;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const DEFAULT_CALENDAR_FILE = new URL('../.data/calendar.json', import.meta.url);

const bad = (message) => new AdapterError('invalid_event', message, { phase: 'pre_send', retryable: false, status: 'failed' });

function mapFsError(e, what) {
  if (['EACCES', 'EPERM', 'EROFS'].includes(e?.code)) {
    return new AdapterError('permission_denied', `${what}: ${e.code}`, { phase: 'pre_send', retryable: true, status: 'permission_denied' });
  }
  return new AdapterError('storage_error', `${what}: ${e?.code ?? e?.message ?? e}`, { phase: 'pre_send', retryable: true, status: 'failed' });
}

const emptyCal = () => ({ version: 1, events: [], tasks: [], notifications: [], seq: 0 });

function readCal(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (e) {
    if (e?.code === 'ENOENT') return emptyCal();
    throw mapFsError(e, 'calendar read');
  }
  let c;
  try { c = JSON.parse(raw); } catch { c = null; }
  if (!c || typeof c !== 'object' || Array.isArray(c)) {
    throw new AdapterError('calendar_corrupt', 'calendar file is not valid JSON; refusing to overwrite it', { phase: 'pre_send', retryable: false, status: 'failed' });
  }
  c.events = Array.isArray(c.events) ? c.events : [];
  c.tasks = Array.isArray(c.tasks) ? c.tasks : [];
  c.notifications = Array.isArray(c.notifications) ? c.notifications : [];
  c.seq = Number.isInteger(c.seq) ? c.seq : 0;
  return c;
}

/** Atomic: write a temp file next to the target, then rename over it. A failure leaves the old file untouched. */
function writeCal(file, c) {
  const tmp = `${file}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(c, null, 1), { mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
    throw mapFsError(e, 'calendar write');
  }
}

const newId = () => randomBytes(5).toString('hex');

/** @param {object} src @param {object} [prev] */
export function cleanEvent(src, prev) {
  const e = Object.assign({}, prev || {});
  if (src.title != null) e.title = String(src.title).trim().slice(0, 120);
  if (src.start != null) {
    const s = String(src.start);
    if (!(ISO_MIN.test(s.slice(0, 16)) || ISO_DAY.test(s))) throw bad('bad start');
    e.allDay = ISO_DAY.test(s);
    e.start = e.allDay ? s : s.slice(0, 16);
  }
  if (src.end !== undefined) e.end = (!e.allDay && ISO_MIN.test(String(src.end).slice(0, 16))) ? String(src.end).slice(0, 16) : null;
  for (const k of ['location', 'note']) if (src[k] != null) e[k] = String(src[k]).slice(0, k === 'note' ? 1000 : 120);
  if (src.type != null) e.type = EVENT_TYPES.includes(src.type) ? src.type : 'appointment';
  if (src.source != null && !prev) e.source = String(src.source).slice(0, 80);
  if (!e.title || !e.start) throw bad('title and start required');
  return e;
}

export function cleanTask(src, prev) {
  const t = Object.assign({}, prev || {});
  if (src.title != null) t.title = String(src.title).trim().slice(0, 120);
  if (src.due !== undefined) t.due = ISO_DAY.test(String(src.due)) ? String(src.due) : null;
  if (src.priority != null) t.priority = ['high', 'normal', 'low'].includes(src.priority) ? src.priority : 'normal';
  if (src.note != null) t.note = String(src.note).slice(0, 1000);
  if (src.status != null) t.status = ['todo', 'done'].includes(src.status) ? src.status : 'todo';
  if (src.source != null && !prev) t.source = String(src.source).slice(0, 80);
  if (!t.title) throw bad('title required');
  t.status = t.status || 'todo';
  t.priority = t.priority || 'normal';
  return t;
}

const kstDay = (ms) => toKstIso(ms).slice(0, 10);
const kstHour = (ms) => Number(toKstIso(ms).slice(11, 13));
const eventStartMs = (e) => (e.allDay ? parseExactIso(`${e.start}T00:00:00+09:00`) : parseExactIso(e.startsAt ?? `${e.start}:00+09:00`));

function viewOf(e) {
  const consistent = typeof e.startsAt === 'string' && e.start === e.startsAt.slice(0, 16);
  return {
    title: e.title,
    startsAt: consistent ? e.startsAt : null, // wall-time alias and full instant must agree, else report as unreadable
    where: e.location ? e.location : null,
    who: e.who ?? null,
    reminders: [...(e.reminders ?? [])].sort((a, b) => b - a),
  };
}

/** @param {{ file?: string|URL, source?: string }} [opts] */
export function createLocalCalendarAdapter({ file = DEFAULT_CALENDAR_FILE, source = 'EBYS (synthetic demo)' } = {}) {
  const stats = { executions: 0 };
  const decoded = file instanceof URL ? fileURLToPath(file) : String(file);

  return {
    stats,
    file: decoded,
    describe: () => ({
      id: 'calendar.local', kind: 'calendar', mode: 'real',
      label: { ko: '이 기기의 EBYS 달력', en: 'EBYS calendar on this device' },
      calendarLabel: { ko: '이 기기의 EBYS 달력', en: 'the EBYS calendar on this device' },
      claimStatus: 'demonstrated', maxVerifyLevel: 'api_readback', canReconcile: true,
      evidence: 'unit tests write and re-read a JSON file in a temp directory. Only an EBYS-local file is involved: no OS, cloud or phone-side calendar.',
      notes: 'Local JSON file; readback = re-read from disk. This is the EBYS app calendar, not the phone calendar.',
    }),
    build: () => null,

    async execute({ op, fault, slowMs, nowMs }) {
      stats.executions += 1;
      if (fault === 'slow') await sleep(slowMs);
      const f = op.fields;
      const c = readCal(decoded);
      const i = c.events.findIndex((x) => x.uid === op.uid);
      const prev = i >= 0 ? structuredClone(c.events[i]) : null;
      // 'mismatch' fault: the store receives a wrong time, which readback must catch
      const startsAt = fault === 'mismatch' ? toKstIso(f.startMs + 3600000) : f.startsAt;
      const e = cleanEvent({
        title: f.title, start: startsAt.slice(0, 16), end: f.endsAt.slice(0, 16), location: f.where ?? '', note: '',
        type: f.kind === 'reminder' ? 'reminder' : 'appointment', source,
      }, prev ?? undefined);
      Object.assign(e, {
        id: prev?.id ?? newId(), uid: op.uid, intentId: op.n.intentId, revision: op.n.revision, sequence: op.sequence,
        sessionId: op.n.sessionId ?? null, who: f.who ?? null, startsAt, endsAt: f.endsAt, reminders: [...f.reminders],
        createdAt: prev?.createdAt ?? toKstIso(nowMs), updatedAt: toKstIso(nowMs),
      });
      const timeChanged = !prev || prev.startsAt !== e.startsAt || JSON.stringify(prev.reminders) !== JSON.stringify(e.reminders);
      e.remindersDone = timeChanged ? [] : (prev.remindersDone ?? []);
      if (i >= 0) c.events[i] = e; else c.events.push(e);
      writeCal(decoded, c);
      const undo = async () => {
        const c2 = readCal(decoded);
        const j = c2.events.findIndex((x) => x.uid === op.uid);
        if (prev) { if (j >= 0) c2.events[j] = prev; else c2.events.push(prev); } else if (j >= 0) c2.events.splice(j, 1);
        writeCal(decoded, c2);
      };
      return { artifact: null, undo };
    },

    /** Re-reads the file from disk (no caching) and returns what is actually stored for this uid. */
    async read({ op }) {
      const e = readCal(decoded).events.find((x) => x.uid === op.uid);
      return e ? viewOf(e) : null;
    },

    async remove({ op }) {
      const c = readCal(decoded);
      const before = c.events.length;
      c.events = c.events.filter((x) => x.uid !== op.uid);
      c.notifications = c.notifications.filter((nt) => nt.uid !== op.uid);
      if (c.events.length !== before) writeCal(decoded, c);
      return !readCal(decoded).events.some((x) => x.uid === op.uid);
    },

    /** Scope: one sessionId, or the whole calendar when sessionId is undefined. Verifies by re-reading the file. */
    purge({ sessionId } = {}) {
      let c;
      try { c = readCal(decoded); } catch (e) { return { verified: false, error: e.code, removedEvents: 0, removedTasks: 0, removedNotifications: 0, remaining: null }; }
      const inScope = (x) => (sessionId === undefined ? true : x.sessionId === sessionId);
      const gone = new Set(c.events.filter(inScope).map((e) => e.uid));
      const evBefore = c.events.length; const tkBefore = c.tasks.length; const ntBefore = c.notifications.length;
      c.events = c.events.filter((e) => !inScope(e));
      c.tasks = c.tasks.filter((t) => !inScope(t));
      c.notifications = sessionId === undefined ? [] : c.notifications.filter((nt) => !gone.has(nt.uid));
      const changed = evBefore !== c.events.length || tkBefore !== c.tasks.length || ntBefore !== c.notifications.length;
      if (changed) {
        try { writeCal(decoded, c); } catch (e) { return { verified: false, error: e.code, removedEvents: 0, removedTasks: 0, removedNotifications: 0, remaining: null }; }
      }
      let remaining;
      try {
        const after = readCal(decoded);
        const staleNotes = sessionId === undefined ? after.notifications.length : after.notifications.filter((nt) => gone.has(nt.uid)).length;
        remaining = after.events.filter(inScope).length + after.tasks.filter(inScope).length + staleNotes;
      } catch { return { verified: false, error: 'reread_failed', removedEvents: evBefore - c.events.length, removedTasks: tkBefore - c.tasks.length, removedNotifications: ntBefore - c.notifications.length, remaining: null }; }
      return { verified: remaining === 0, removedEvents: evBefore - c.events.length, removedTasks: tkBefore - c.tasks.length, removedNotifications: ntBefore - c.notifications.length, remaining };
    },

    /** Port of calAddEvent (generic event, e.g. all-day). The service itself uses execute() with a stable uid instead. */
    addEvent(src, { nowMs = Date.now() } = {}) {
      const c = readCal(decoded);
      const e = cleanEvent({ source, ...src });
      e.id = newId(); e.createdAt = toKstIso(nowMs);
      if (src.sessionId !== undefined) e.sessionId = src.sessionId;
      c.events.push(e);
      writeCal(decoded, c);
      return e;
    },

    /** Task list kept from the source (not wired to ActionIntents yet). */
    addTask(src, { nowMs = Date.now() } = {}) {
      const c = readCal(decoded);
      const t = cleanTask(src);
      t.id = newId(); t.createdAt = toKstIso(nowMs); if (src.sessionId !== undefined) t.sessionId = src.sessionId;
      c.tasks.push(t);
      writeCal(decoded, c);
      return t;
    },
    listEvents: () => readCal(decoded).events,
    listTasks: () => readCal(decoded).tasks,

    /**
     * Reminder sweep (source rules, see header). Returns the notifications created by THIS sweep; all are persisted.
     * @param {number} nowMs
     */
    sweep(nowMs) {
      const c = readCal(decoded);
      const fresh = [];
      let changed = false;
      const push = (o) => { c.seq += 1; const nt = { n: c.seq, ts: toKstIso(nowMs), type: 'reminder', source: 'calendar.local', mode: 'real', delivery: 'in_app_poll',
        label: { ko: 'EBYS 알림 (앱 안에서 표시, 휴대폰 알림 아님)', en: 'EBYS reminder (shown inside the app, not a phone notification)' }, ...o }; c.notifications.push(nt); fresh.push(nt); changed = true; };
      for (const e of c.events) {
        const startMs = eventStartMs(e);
        if (startMs === null) continue;
        const hhmm = e.allDay ? '' : e.start.slice(11, 16);
        const place = e.location ? ` · ${e.location}` : '';
        const base = { eventId: e.id, uid: e.uid, intentId: e.intentId ?? null };
        if (e.allDay) {
          const at = parseExactIso(`${e.start}T08:00:00+09:00`);
          const endMs = parseExactIso(`${e.start}T23:59:59+09:00`);
          if (e.reminded) continue;
          if (nowMs >= at && nowMs < endMs) {
            push({ ...base, id: `cal:${e.uid ?? e.id}:allday`, fireAt: toKstIso(at), offsetMin: null,
              title: { ko: `오늘: ${e.title}${place}`, en: `Today: ${e.title}${place}` }, body: { ko: e.who ? `${e.who}님과` : '', en: e.who ? `with ${e.who}` : '' } });
            e.reminded = true;
          } else if (nowMs >= endMs) { e.reminded = true; changed = true; }
          continue;
        }
        const offsets = (Array.isArray(e.reminders) && e.reminders.length ? [...e.reminders] : DEFAULT_OFFSETS).sort((a, b) => b - a);
        const done = new Set(e.remindersDone ?? []);
        if (nowMs >= startMs) { // event already started: missed reminders are closed silently (source behaviour)
          if (offsets.some((o) => !done.has(o))) { e.remindersDone = offsets; changed = true; }
          continue;
        }
        const due = offsets.filter((o) => !done.has(o) && nowMs >= startMs - o * 60000);
        if (!due.length) continue;
        const nearest = Math.min(...due);
        push({ ...base, id: `cal:${e.uid ?? e.id}:${nearest}`, fireAt: toKstIso(startMs - nearest * 60000), offsetMin: nearest,
          title: { ko: `${hhmm} ${e.title}${place}`, en: `${displayParts(startMs).time12} ${e.title}${place}` },
          body: { ko: `${nearest}분 후 시작${e.who ? ` · ${e.who}님` : ''}`, en: `Starts in ${humanMinutes(nearest)}${e.who ? ` · with ${e.who}` : ''} (Seoul time)` } });
        e.remindersDone = [...new Set([...done, ...due])];
      }
      const today = kstDay(nowMs);
      for (const t of c.tasks) {
        if (t.status === 'done' || t.reminded === today || t.due !== today) continue;
        if (kstHour(nowMs) >= 9) {
          push({ eventId: t.id, uid: null, intentId: null, id: `task:${t.id}:${t.due}`, fireAt: `${today}T09:00:00+09:00`, offsetMin: null,
            title: { ko: `오늘 기한: ${t.title}`, en: `Due today: ${t.title}` }, body: { ko: '', en: '' } });
          t.reminded = today;
        }
      }
      if (c.notifications.length > MAX_NOTIFICATIONS) c.notifications = c.notifications.slice(-MAX_NOTIFICATIONS);
      if (changed) writeCal(decoded, c);
      return fresh;
    },

    notificationsSince(n = 0) { return readCal(decoded).notifications.filter((x) => x.n > n); },
    lastNotificationN() { return readCal(decoded).seq; },
  };
}
