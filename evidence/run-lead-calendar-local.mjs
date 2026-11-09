// Lead live check of the EBYS local calendar (adapters calendar.local: a JSON file on this computer, not the phone calendar).
// Usage (server started with EBYS_CALENDAR=local): node evidence/run-lead-calendar-local.mjs
import { readFile, writeFile } from 'node:fs/promises';

const BASE = process.env.EBYS_URL ?? 'http://127.0.0.1:8787';
const CALENDAR_FILE = new URL('../.data/calendar.json', import.meta.url);
const TEXT = [
  'Daniel: Mom, I booked your eye check at Riverside Clinic for Thursday, November 12 at 2:30 PM.',
  'Mom: Thursday the 12th at 2:30 in the afternoon. Will you drive me?',
  'Daniel: Yes, I will pick you up at 2.',
].join('\n');

async function call(method, path, body) {
  const t0 = Date.now();
  const res = await fetch(BASE + path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body && JSON.stringify(body), signal: AbortSignal.timeout(400_000) });
  return { method, path, request: body ?? null, httpStatus: res.status, wallMs: Date.now() - t0, body: await res.json() };
}
const fail = (why) => { console.error('FAIL', why); process.exitCode = 1; };

const out = { capturedAt: new Date().toISOString(), note: 'lead live calendar.local check; synthetic text; the EBYS local calendar file is not the phone calendar and no OS notification is sent', runtime: (await call('GET', '/api/runtime')).body.data, calls: [] };
const step = async (...a) => { const c = await call(...a); out.calls.push(c); return c.body.data ?? c.body; };

const ingest = await step('POST', '/api/ingest', { title: 'synthetic eye check', text: TEXT, provenance: 'synthetic' });
const mem = (await step('GET', '/api/memories')).memories.find((m) => m.kind === 'event' && m.when?.state === 'known' && ingest.memoryIds?.includes?.(m.id) !== false);
if (!mem) fail('no exact event memory from ingest');
else {
  const p = await step('POST', '/api/propose', { memoryId: mem.id });
  const proposalId = p.id ?? p.proposal?.id;
  const pv = await step('POST', '/api/preview', { proposalId });
  const rec = await step('POST', '/api/confirm', { proposalId, previewDigest: pv.previewDigest });
  const rb = await step('GET', `/api/readback/${encodeURIComponent(rec.recordId)}`);
  await step('GET', '/api/notifications?since=0');
  const stored = JSON.parse(await readFile(CALENDAR_FILE, 'utf8'));
  const events = stored.events ?? stored;
  const event = events.find((e) => e.intentId === proposalId);
  const fields = pv.preview?.fields ?? pv.preview;
  const [, hh, mm] = fields.startsAt.match(/T(\d\d):(\d\d)/);
  const h12 = `${(+hh % 12) || 12}:${mm}`;
  const sourceHasTime = TEXT.includes(`${h12} ${+hh < 12 ? 'AM' : 'PM'}`) || (mm === '00' && new RegExp(`at ${(+hh % 12) || 12} ?${+hh < 12 ? 'AM' : 'PM'}`).test(TEXT));
  out.calendarFile = { path: '.data/calendar.json', matchedEvent: event ?? null, eventCount: events.length };
  out.result = { memoryWhen: mem.when?.value, memoryWhenQuotes: mem.when?.evidence?.map((e) => e.quote), previewFields: fields, confirmDisplayState: rec.displayState, verifyLevel: rec.verifyLevel, readbackDisplayState: rb.displayState, readbackVerifyLevel: rb.verifyLevel, fileMatchesPreview: event?.startsAt === fields.startsAt, readbackMatchesFile: JSON.stringify(rb).includes(event?.startsAt ?? '\u0000'), confirmedTimeStatedInSource: sourceHasTime };
  if (rec.displayState !== 'completed_external') fail(`confirm displayState ${rec.displayState}`);
  if (rb.displayState !== 'completed_external') fail(`readback displayState ${rb.displayState}`);
  if (!event) fail('confirmed event not found in .data/calendar.json');
  else if (!out.result.fileMatchesPreview) fail('stored start differs from the previewed start');
  if (!out.result.readbackMatchesFile) fail('readback does not carry the stored start');
  if (!sourceHasTime) fail(`confirmed start ${fields.startsAt} is not the time stated in the conversation`);
}
const file = `evidence/lead-calendar-local-${out.capturedAt.replace(/[:.]/g, '-')}.json`;
await writeFile(file, JSON.stringify(out, null, 2));
console.log('saved', file, 'serverCurrent', out.runtime.sourceSnapshot?.serverCurrent, 'calendar', JSON.stringify(out.runtime.calendar));
console.log(JSON.stringify(out.result, null, 1));
console.log('event in file:', JSON.stringify(out.calendarFile?.matchedEvent));
console.log('ingest mode', ingest.mode, 'route', ingest.telemetry?.route?.id, ingest.telemetry?.route?.model, 'cached', ingest.telemetry?.route?.cached);
