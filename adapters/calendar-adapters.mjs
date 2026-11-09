// Calendar adapters. Owner: sj-actions.
//  calendar.simulated   : in-memory "Demo Calendar". Result is always status completed + mode simulated + verifyLevel none.
//  calendar.ics-handoff : builds an RFC 5545 file for the phone's calendar app. Result is handed_off, never completed.
// Adapters never read the clock themselves and never touch the network or filesystem.
import { buildIcs, icsToView } from './ics.mjs';
import { toKstIso } from './format.mjs';

/** Thrown by adapters/fault layer. phase tells whether anything could have left the app. */
export class AdapterError extends Error {
  constructor(code, message, { phase = 'pre_send', retryable = false, status = 'failed' } = {}) {
    super(message);
    this.code = code; this.phase = phase; this.retryable = retryable; this.status = status;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createSimulatedCalendarAdapter() {
  /** @type {Map<string, any>} uid -> entry */
  const entries = new Map();
  const stats = { executions: 0 };
  return {
    stats,
    describe: () => ({
      id: 'calendar.simulated', kind: 'calendar', mode: 'simulated',
      label: { ko: '시뮬레이션 달력 (앱 안에서만)', en: 'Simulated calendar (inside this app only)' },
      claimStatus: 'simulated', maxVerifyLevel: 'none', canReconcile: true,
      notes: 'In-memory Demo Calendar. Nothing is written to any phone or account.',
    }),
    build: () => null,
    /** @param {{ op:{uid,sequence,fields}, fault?:string, slowMs:number }} ctx */
    async execute({ op, fault, slowMs }) {
      stats.executions += 1;
      if (fault === 'slow') await sleep(slowMs);
      const f = op.fields;
      entries.set(op.uid, {
        uid: op.uid, sequence: op.sequence,
        title: f.title, startMs: f.startMs, where: f.where, who: f.who, reminders: [...f.reminders],
        // 'mismatch' fault: the "calendar" stores a wrong time, which the readback must catch
        ...(fault === 'mismatch' ? { startMs: f.startMs + 3600000 } : {}),
      });
      return { artifact: null };
    },
    async read({ op }) {
      const e = entries.get(op.uid);
      if (!e) return null;
      return { title: e.title, startsAt: toKstIso(e.startMs), where: e.where, who: e.who, reminders: [...e.reminders].sort((a, b) => b - a) };
    },
    async remove({ op }) { entries.delete(op.uid); return !entries.has(op.uid); },
    has: (uid) => entries.has(uid),
    size: () => entries.size,
  };
}

export function createIcsHandoffAdapter() {
  const stats = { executions: 0 };
  return {
    stats,
    describe: () => ({
      id: 'calendar.ics-handoff', kind: 'calendar', mode: 'real',
      label: { ko: '달력 파일(.ics) 전달', en: 'Calendar file (.ics) handoff' },
      claimStatus: 'unverified', maxVerifyLevel: 'handoff', canReconcile: false,
      notes: 'Generates a real RFC 5545 file; unit-tested. Whether a phone imports it is unverified. EBYS can never confirm a save.',
    }),
    build(f, ctx) {
      return { kind: 'ics', mime: 'text/calendar; charset=utf-8', text: icsFor(f, ctx) };
    },
    async execute({ op, fault, slowMs, nowMs }) {
      stats.executions += 1;
      if (fault === 'slow') await sleep(slowMs);
      let content = icsFor(op.fields, { uid: op.uid, sequence: op.sequence, nowMs });
      // 'mismatch' fault: the generated file has a wrong start time; the payload readback must catch it
      if (fault === 'mismatch') content = content.replace(/DTSTART:(\d{8}T)(\d{2})/, (_m, d, h) => `DTSTART:${d}${String((Number(h) + 1) % 24).padStart(2, '0')}`);
      const day = toKstIso(op.fields.startMs).slice(0, 16).replace(/[-:T]/g, '');
      return { artifact: { filename: `ebys-${day}.ics`, mime: 'text/calendar; charset=utf-8', content } };
    },
    /** Payload-level readback only (parses our own file). Does NOT prove the phone calendar has the event. */
    async read({ artifact }) { return artifact ? icsToView(artifact.content) : null; },
    async remove() { return true; },
  };
}

function icsFor(f, { uid, sequence, nowMs }) {
  return buildIcs({
    uid, sequence, title: f.title, startMs: f.startMs, durationMin: f.durationMin,
    place: f.where, who: f.who, reminders: f.reminders, nowMs,
  });
}
