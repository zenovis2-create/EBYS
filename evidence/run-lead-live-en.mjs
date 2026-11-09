// Lead live check: a NEW synthetic English conversation through the running server, query lang omitted.
// Usage (server must be up): node evidence/run-lead-live-en.mjs
import { writeFile } from 'node:fs/promises';

const BASE = process.env.EBYS_URL ?? 'http://127.0.0.1:8787';
const TEXT = [
  'Priya: Grandpa, Tom from the library called. The book club moved from Wednesday to Thursday at 2.',
  'Grandpa: Thursday at 2, got it. Is it still in the community room?',
  "Priya: No, this time it's at the Oak Street cafe.",
  'Grandpa: And Martha is bringing the cake, right?',
  "Priya: Yes, Martha said she'd bring a lemon cake.",
].join('\n');
const QUESTIONS = ['Where is the book club now, and who told us?', 'What time is the book club on Thursday?', 'Who is bringing the cake?', 'What is the bus route to the cafe?'];

async function call(method, path, body) {
  const t0 = Date.now();
  const res = await fetch(BASE + path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body && JSON.stringify(body), signal: AbortSignal.timeout(400_000) });
  return { method, path, request: body ?? null, httpStatus: res.status, wallMs: Date.now() - t0, body: await res.json() };
}

const out = { capturedAt: new Date().toISOString(), note: 'lead live English check; synthetic text, not a fixture or QA held-out; proves route/telemetry/lang default, not QA scoring', runtime: (await call('GET', '/api/runtime')).body.data, calls: [] };
out.calls.push(await call('POST', '/api/ingest', { title: 'synthetic book club', text: TEXT, provenance: 'synthetic' }));
for (const text of QUESTIONS) out.calls.push(await call('POST', '/api/query', { text }));
const file = `evidence/lead-live-en-${out.capturedAt.replace(/[:.]/g, '-')}.json`;
await writeFile(file, JSON.stringify(out, null, 2));

console.log('saved', file, 'serverCurrent', out.runtime.sourceSnapshot?.serverCurrent);
for (const c of out.calls) {
  const d = c.body.data ?? {};
  const t = d.telemetry ?? {};
  console.log(`${c.path} http=${c.httpStatus} wall=${c.wallMs} mode=${d.mode} route=${t.route?.id}/${t.route?.model} cached=${t.route?.cached} raw=${t.rawModelJson != null} valid=${t.validation?.ok}${d.lang ? ` lang=${d.lang}` : ''}`);
  if (c.path === '/api/query') {
    console.log(`   Q: ${c.request.text}  found=${d.found}`);
    for (const s of ['who', 'when', 'where', 'what']) {
      const sl = d.slots?.[s];
      if (sl) console.log(`   ${s}: ${sl.state}/${sl.uncertainty} "${sl.display ?? ''}" quote="${sl.evidence?.[0]?.quote ?? ''}"`);
    }
    if (d.sentence?.en) console.log(`   en: ${d.sentence.en}`);
  } else console.log(`   created=${d.memoriesCreated} rejected=${d.rejected}`, c.body.ok === false ? JSON.stringify(c.body.error) : '');
}
