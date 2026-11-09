// Minimal RFC 5545 builder + parser (zero deps, browser-safe). Owner: sj-actions.
// Output is a handoff artifact: the phone's calendar app decides whether to import it.
// Only ACTION:DISPLAY alarms are ever written (never EMAIL/AUDIO/PROCEDURE), and no ATTENDEE/ORGANIZER/URL lines.
import { toIcsUtc, parseExactIso, toKstIso } from './format.mjs';

const enc = new TextEncoder();

export function escapeText(s) {
  return String(s)
    .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}
export function unescapeText(s) {
  return String(s).replace(/\\([\\;,nN])/g, (_m, c) => (c === 'n' || c === 'N' ? '\n' : c));
}

/** Fold to <= 75 octets per line (UTF-8 aware; never splits a code point). */
export function foldLine(line) {
  if (enc.encode(line).length <= 75) return line;
  const out = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (bytes + b > 75) { out.push(cur); cur = ' '; bytes = 1; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join('\r\n');
}

export function triggerFor(min) {
  if (min % 1440 === 0) return `-P${min / 1440}D`;
  if (min % 60 === 0) return `-PT${min / 60}H`;
  return `-PT${min}M`;
}
function minutesFromTrigger(t) {
  const m = /^-P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(t);
  if (!m) return null;
  return Number(m[1] ?? 0) * 1440 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

/**
 * @param {{ uid:string, sequence:number, title:string, startMs:number, durationMin:number, place?:string|null,
 *   who?:string|null, reminders:number[], nowMs:number, sourceLabel?:string }} e  (all text already cleaned)
 */
export function buildIcs(e) {
  const end = e.startMs + e.durationMin * 60000;
  const desc = [`With: ${e.who || '(unknown)'}`, `Source: ${e.sourceLabel ?? 'synthetic demo conversation (EBYS)'}`].join('\n');
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//EBYS//Hackathon Demo//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${e.uid}`,
    `DTSTAMP:${toIcsUtc(e.nowMs)}`,
    `DTSTART:${toIcsUtc(e.startMs)}`,
    `DTEND:${toIcsUtc(end)}`,
    `SEQUENCE:${Math.max(0, e.sequence)}`,
    `SUMMARY:${escapeText(e.title)}`,
  ];
  if (e.place) lines.push(`LOCATION:${escapeText(e.place)}`);
  lines.push(`DESCRIPTION:${escapeText(desc)}`, 'STATUS:CONFIRMED');
  for (const min of e.reminders) {
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(e.title)}`, `TRIGGER:${triggerFor(min)}`, 'END:VALARM');
  }
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

/** Parse our own output back (payload-level readback; says nothing about whether any phone imported it). */
export function parseIcs(text) {
  const raw = String(text).replace(/\r?\n[ \t]/g, '').split(/\r?\n/).filter(Boolean);
  const ev = { alarms: [], actions: [], lines: raw };
  let inEvent = false;
  let alarm = null;
  for (const line of raw) {
    if (line === 'BEGIN:VEVENT') { inEvent = true; continue; }
    if (line === 'END:VEVENT') { inEvent = false; continue; }
    if (line === 'BEGIN:VALARM') { alarm = {}; continue; }
    if (line === 'END:VALARM') { ev.alarms.push(alarm); alarm = null; continue; }
    const i = line.indexOf(':');
    if (i < 0) continue;
    const key = line.slice(0, i).split(';')[0];
    const val = line.slice(i + 1);
    if (alarm) {
      if (key === 'ACTION') ev.actions.push(val);
      if (key === 'TRIGGER') alarm.triggerMin = minutesFromTrigger(val);
      continue;
    }
    if (!inEvent) continue;
    if (key === 'UID') ev.uid = val;
    if (key === 'SEQUENCE') ev.sequence = Number(val);
    if (key === 'SUMMARY') ev.title = unescapeText(val);
    if (key === 'LOCATION') ev.place = unescapeText(val);
    if (key === 'DESCRIPTION') ev.description = unescapeText(val);
    if (key === 'DTSTART') ev.startMs = parseExactIso(val.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z'));
    if (key === 'DTEND') ev.endMs = parseExactIso(val.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z'));
  }
  const who = /^With: (.*)$/m.exec(ev.description ?? '')?.[1];
  ev.who = who && who !== '(unknown)' ? who : null;
  return ev;
}

/** View used for readback comparison. */
export function icsToView(text) {
  const ev = parseIcs(text);
  return {
    title: ev.title ?? null,
    startsAt: Number.isFinite(ev.startMs) ? toKstIso(ev.startMs) : null,
    where: ev.place ?? null,
    who: ev.who,
    reminders: ev.alarms.map((a) => a.triggerMin).filter((n) => Number.isInteger(n)).sort((a, b) => b - a),
  };
}
