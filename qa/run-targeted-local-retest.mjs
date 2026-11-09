// Lead-ready targeted QA. One pass; synthetic text only; one explicitly reviewed local-calendar confirmation.
// Writes only qa/ artifacts directly. The authorized /api/confirm may append our event to the app's local file.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadScenarios, evaluateAnswer, evaluateModelEvidence } from './run-heldout.mjs';

const qa = dirname(fileURLToPath(import.meta.url)), project = resolve(qa, '..');
const hash = value => createHash('sha256').update(value).digest('hex');
const unwrap = value => value?.data ?? value;
const START = '2027-04-19T14:30:00+09:00';
const PLACE = 'Glass Meadow workshop';
const EXPECTED_STARTUP = '2026-11-09T04:27:25.704Z';
const EXPECTED_HASH_PREFIX = '4808156bf636';
const localText = (await readFile(join(qa, 'local-calendar/independent-230.txt'), 'utf8')).trim();
const [ko, en] = await loadScenarios();
const englishText = (await readFile(join(qa, 'english-first/conversation.txt'), 'utf8')).trim();
const englishExpected = JSON.parse(await readFile(join(qa, 'english-first/expected.json'), 'utf8'));
const groups = [
  { ...en, questions: en.questions.filter(q => ['ambiguous-time', 'unanswerable'].includes(q.id)) },
  { ...ko, questions: ko.questions.filter(q => q.id === 'unanswerable') },
  { id: 'english-first', lang: 'en', text: englishText, questions: englishExpected.questions.filter(q => ['ambiguous-swap', 'unknown-equipment'].includes(q.id)) },
];
function candidatesFor(memories, ingestion) {
  return memories.filter(m => ingestion.memoryIds?.includes(m.id)
    && (m.sessionId ?? m.meta?.sessionId) === ingestion.sessionId && m.kind === 'event'
    && m.status === 'candidate' && /printmaking/i.test(m.summary?.en ?? ''));
}
if (process.argv.includes('--validate')) {
  if (!localText.includes('2:30 PM') || groups.reduce((n, g) => n + g.questions.length, 0) !== 5
    || Date.parse(START) === Date.parse('2027-04-19T14:00:00+09:00')) throw new Error('Invalid targeted fixtures');
  const isolated = [{ id: 'm-test', kind: 'event', status: 'candidate', meta: { sessionId: 's-test' }, summary: { en: 'Printmaking' } }];
  if (candidatesFor(isolated, { sessionId: 's-test', memoryIds: ['m-test'] }).length !== 1
    || candidatesFor(isolated, { sessionId: 'other-session', memoryIds: ['m-test'] }).length !== 0) throw new Error('Candidate identity guard failed');
  console.log(JSON.stringify({ status: 'PASS', questions: 5, ambiguityCases: 2, absentFactCases: 3, plannedModelRequests: 9,
    calendarStart: START, wrongTwoOClockRejected: true, actualHttpCalls: 0 }));
  process.exit(0);
}
const resumeIndex = process.argv.indexOf('--resume');
const resumePath = resumeIndex >= 0 ? resolve(process.argv[resumeIndex + 1] ?? '') : null;
if (resumePath && !resumePath.startsWith(join(qa, 'evidence') + '/'.replace('/', process.platform === 'win32' ? '\\' : '/'))) throw new Error('Resume source must be inside qa/evidence/');
const resumeRaw = resumePath ? await readFile(resumePath, 'utf8') : null;
const inherited = resumeRaw ? JSON.parse(resumeRaw) : null;
if (inherited && (inherited.localFixture?.sha256 !== hash(localText) || inherited.requests.some(r => r.path === '/api/confirm')
    || inherited.questions.length !== 5)) throw new Error('Unsafe/incompatible resume source; never retry confirmation or model calls');
const stamp = new Date().toISOString();
const output = join(qa, 'evidence', `targeted-local-${stamp.replace(/[:.]/g, '-')}-${process.pid}`);
await mkdir(output, { recursive: true });
const report = { producer: 'sj-qa', startedAt: stamp, authorization: 'LEAD-READY 13:30; five targeted questions + one independent EBYS-local event',
  runnerSha256: hash(await readFile(fileURLToPath(import.meta.url))), requests: [], questions: inherited?.questions ?? [], modelEvidence: inherited?.modelEvidence ?? [], localChecks: [],
  ...(inherited ? { resumedFrom: resumePath, resumedFromSha256: hash(resumeRaw), resumptionReason: 'QA selector corrected to Memory.meta.sessionId plus ingest memoryIds; no model replay; original failed report unchanged' } : {}),
  localFixture: { text: localText, sha256: hash(localText), expectedStartsAt: START, where: PLACE, person: 'Kai' }, status: 'RUNNING',
  limitations: ['API/file test only; no browser, physical phone, OS calendar/notification or voice acceptance.',
    'No data cleanup/cancel/deleteAll/restarts and no automatic retries; the synthetic local event remains for lead review.',
    'Copies of the shared calendar retain only our target event and hashes/counts for other events.'] };
const save = () => writeFile(join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
let transportLost = false;
async function call(method, path, payload, caseId) {
  const allowed = method === 'GET' ? path === '/api/runtime' || path === '/api/memories' || /^\/api\/readback\/[^/]+$/.test(path)
    : ['/api/ingest', '/api/query', '/api/propose', '/api/preview', '/api/confirm'].includes(path);
  if (!allowed || transportLost) throw new Error('No call permitted outside target scope/after transport loss');
  const requestedAt = new Date().toISOString(), started = performance.now();
  const result = { method, path, caseId, requestedAt, ...(payload ? { payload } : {}) };
  try {
    const response = await fetch(`http://127.0.0.1:8787${path}`, { method, redirect: 'error',
      signal: AbortSignal.timeout(['/api/ingest', '/api/query'].includes(path) ? 180_000 : 30_000),
      ...(payload ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) } : {}) });
    result.httpStatus = response.status;
    result.raw = await response.text();
    try { result.body = JSON.parse(result.raw); } catch { /* Raw failures retained. */ }
  } catch (error) { result.transportError = `${error.name}: ${error.message}`; result.cause = error.cause?.message; transportLost = true; }
  result.completedAt = new Date().toISOString(); result.elapsedMs = Math.round(performance.now() - started);
  report.requests.push(result); await save();
  const data = unwrap(result.body);
  console.log(JSON.stringify({ caseId, method, path, httpStatus: result.httpStatus, elapsedMs: result.elapsedMs, route: data?.telemetry?.route ?? data?.route, error: result.transportError }));
  return result;
}
function dataOf(result) {
  if (result.transportError || result.httpStatus !== 200 || result.body?.ok === false) throw new Error(`Request not usable: ${result.caseId}; inspect original response`);
  return unwrap(result.body);
}
function evidence(result) { const verdict = evaluateModelEvidence(result.body); report.modelEvidence.push({ caseId: result.caseId, ...verdict }); return verdict; }
function ensure(condition, id, detail) {
  report.localChecks.push({ id, status: condition ? 'PASS' : 'FAIL', detail });
  if (!condition) throw new Error(`Local guard failed: ${id}; confirmation not sent unless already recorded`);
}
function expectedRuntime(result) {
  const d = dataOf(result), s = d.sourceSnapshot;
  return s?.serverLoaded?.startedAt === EXPECTED_STARTUP && s?.serverLoaded?.sha256?.startsWith(EXPECTED_HASH_PREFIX)
    && d.calendar?.kind === 'ebys_local' && d.mode === 'real' && d.adapters?.some(a => a.id === 'calendar.local' && a.mode === 'real');
}
async function calendarFile() {
  try { const raw = await readFile(join(project, '.data/calendar.json'), 'utf8'); return { raw, sha256: hash(raw), value: JSON.parse(raw), readAt: new Date().toISOString() }; }
  catch (error) { if (error.code === 'ENOENT') return { raw: null, sha256: null, value: { events: [] }, readAt: new Date().toISOString() }; throw error; }
}
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const sameInstant = (a, b) => typeof a === 'string' && typeof b === 'string' && Number.isFinite(Date.parse(a)) && Date.parse(a) === Date.parse(b);
let beforeRuntime;
try {
  beforeRuntime = await call('GET', '/api/runtime', null, 'runtime-before');
  await writeFile(join(output, 'runtime-before.json'), `${JSON.stringify({ capturedAt: beforeRuntime.completedAt, ...beforeRuntime }, null, 2)}\n`);
  if (!expectedRuntime(beforeRuntime) || dataOf(beforeRuntime).sourceSnapshot.serverCurrent !== true) throw new Error('Lead-ready runtime/hash/local-mode preflight does not match; no model calls started');
  if (!inherited) for (const group of groups) {
    const ingestion = await call('POST', '/api/ingest', { title: `Targeted ${group.id} synthetic ${stamp}`, text: group.text, lang: group.lang, provenance: 'synthetic' }, `${group.id}/ingest`);
    const ingested = dataOf(ingestion); evidence(ingestion);
    if (!ingested.sessionId || !Array.isArray(ingested.utterances)) throw new Error('Ingest contract missing session/utterances');
    for (const question of group.questions) {
      const response = await call('POST', '/api/query', { text: question.text, lang: group.lang }, `${group.id}/${question.id}`);
      const answer = dataOf(response); evidence(response);
      const checks = (question.checks ?? [question]).map(check => evaluateAnswer(answer, check, ingested.utterances, group.text));
      report.questions.push({ id: `${group.id}/${question.id}`, kind: question.rule === 'ambiguous' || question.id === 'ambiguous-swap' ? 'ambiguity' : 'absent-fact',
        expected: question, status: checks.every(c => c.status === 'PASS') ? 'PASS' : 'FAIL', checks });
      await save();
    }
  }
  const localIngest = inherited ? inherited.requests.find(r => r.caseId === 'local/ingest')
    : await call('POST', '/api/ingest', { title: `Independent 2:30 PM local calendar ${stamp}`, text: localText, lang: 'en', provenance: 'synthetic' }, 'local/ingest');
  const localData = dataOf(localIngest);
  ensure((inherited ? evaluateModelEvidence(localIngest.body) : evidence(localIngest)).status === 'PASS', 'local_model_evidence', 'Original model JSON, validation and real route required');
  const memories = dataOf(await call('GET', '/api/memories', null, 'local/memories'));
  const candidates = candidatesFor(memories.memories, localData);
  report.localCandidates = candidates;
  ensure(candidates.length === 1, 'one_local_candidate', { count: candidates.length });
  const memory = candidates[0];
  const sourceAnswer = { found: true, slots: { who: memory.who, when: memory.when, where: memory.where, what: memory.what } };
  const sourceChecks = [
    { slot: 'when', rule: 'exact', acceptedValues: [START, '2027-04-19T05:30:00Z'], evidenceMustContain: '2:30 PM' },
    { slot: 'who', rule: 'contains', acceptedValues: ['Kai'], evidenceMustContain: 'Kai' },
    { slot: 'where', rule: 'contains', acceptedValues: [PLACE], evidenceMustContain: PLACE },
  ].map(check => evaluateAnswer(sourceAnswer, check, localData.utterances, localText));
  ensure(sourceChecks.every(c => c.status === 'PASS'), 'memory_exact_230_and_sources', sourceChecks);
  const proposalCall = await call('POST', '/api/propose', { memoryId: memory.id }, 'local/propose');
  const proposal = dataOf(proposalCall); report.proposalId = proposal.id;
  ensure(proposal.state === 'proposed' && sameInstant(proposal.fields.startsAt, START), 'proposal_exact_230', proposal.fields);
  const previewCall = await call('POST', '/api/preview', { proposalId: proposal.id }, 'local/preview');
  const preview = dataOf(previewCall), fields = preview.preview?.fields;
  ensure(preview.adapterId === 'calendar.local' && preview.mode === 'real' && !preview.needs_clarification
    && sameInstant(fields?.startsAt, START) && fields?.where === PLACE && /Kai/.test(fields?.who ?? '')
    && typeof preview.previewDigest === 'string', 'preview_exact_and_bound', preview);
  const label = preview.preview?.modeLabel?.en ?? '';
  ensure(/EBYS calendar on this device/i.test(label) && /not your phone calendar/i.test(label), 'honest_local_preview_label', label);
  const preconfirmRuntime = await call('GET', '/api/runtime', null, 'runtime-preconfirm');
  ensure(expectedRuntime(preconfirmRuntime), 'same_authorized_runtime_before_confirm', dataOf(preconfirmRuntime).sourceSnapshot);
  const beforeDisk = await calendarFile();
  const uid = `sj-${hash(String(proposal.id)).slice(0, 24)}@ebys.local`;
  ensure(!beforeDisk.value.events.some(e => e.intentId === proposal.id || e.uid === uid), 'no_existing_intent_or_uid_overwrite', { proposalId: proposal.id, uid });
  await writeFile(join(output, 'calendar-before.json'), `${JSON.stringify({ source: '.data/calendar.json', readAt: beforeDisk.readAt,
    sha256: beforeDisk.sha256, eventCount: beforeDisk.value.events.length, existingEventHashes: beforeDisk.value.events.map(e => ({ uid: e.uid, sha256: hash(JSON.stringify(e)) })) }, null, 2)}\n`);
  report.confirmationDecision = { reviewedAt: new Date().toISOString(), actor: 'sj-qa', authorization: 'Explicit lead-ready synthetic local-calendar acceptance test',
    proposalId: proposal.id, revision: proposal.revision, previewDigest: preview.previewDigest, fields, decision: 'CONFIRM exact 2:30 PM event in EBYS local calendar only' };
  await save();
  const confirmedCall = await call('POST', '/api/confirm', { proposalId: proposal.id, previewDigest: preview.previewDigest }, 'local/confirm');
  const confirmed = dataOf(confirmedCall); report.recordId = confirmed.recordId;
  await writeFile(join(output, 'confirm-response.json'), `${JSON.stringify(confirmedCall, null, 2)}\n`);
  ensure(confirmed.status === 'completed' && confirmed.mode === 'real' && confirmed.adapterId === 'calendar.local'
    && confirmed.verifyLevel === 'api_readback' && confirmed.displayState === 'completed_external', 'confirmed_real_local_readback_state', confirmed);
  const readbackCall = await call('GET', `/api/readback/${encodeURIComponent(confirmed.recordId)}`, null, 'local/get-readback');
  const readback = dataOf(readbackCall);
  await writeFile(join(output, 'readback-response.json'), `${JSON.stringify(readbackCall, null, 2)}\n`);
  const afterDisk = await calendarFile();
  const matches = afterDisk.value.events.filter(e => e.intentId === proposal.id && e.uid === uid);
  const event = matches[0];
  const othersPreserved = beforeDisk.value.events.every(old => afterDisk.value.events.some(now => now.uid === old.uid && same(now, old)));
  await writeFile(join(output, 'calendar-file-target.json'), `${JSON.stringify({ source: '.data/calendar.json', readAt: afterDisk.readAt, sha256: afterDisk.sha256,
    eventCount: afterDisk.value.events.length, events: matches, originalEventsPreserved: othersPreserved, scope: 'Only this QA event copied; other event contents omitted' }, null, 2)}\n`);
  report.localExpected = fields;
  ensure(matches.length === 1 && othersPreserved, 'one_disk_event_and_others_preserved', { matches: matches.length, othersPreserved });
  ensure(readback.status === 'completed' && readback.mode === 'real' && readback.verifyLevel === 'api_readback'
    && readback.displayState === 'completed_external' && readback.recordId === confirmed.recordId, 'get_readback_completed_external', readback);
  for (const key of ['title', 'startsAt', 'who', 'where', 'reminders']) {
    const diskValue = key === 'where' ? event?.location ?? null : event?.[key];
    const equal = (a, b) => key === 'startsAt' ? sameInstant(a, b) : key === 'reminders' ? same([...(a ?? [])].sort(), [...(b ?? [])].sort()) : same(a, b);
    ensure(equal(fields[key], diskValue) && equal(fields[key], confirmed.readback?.[key]) && equal(fields[key], readback.readback?.[key]), `preview_confirm_disk_get_match_${key}`, { expected: fields[key], disk: diskValue, confirm: confirmed.readback?.[key], get: readback.readback?.[key] });
  }
  ensure(event.start === START.slice(0, 16) && sameInstant(event.startsAt, START) && sameInstant(event.endsAt, fields.endsAt), 'disk_minutes_timezone_and_end', { start: event.start, startsAt: event.startsAt, endsAt: event.endsAt });
  ensure(/EBYS calendar on this device/i.test(readback.calendarLabel?.en ?? '')
    && /EBYS calendar on this device/i.test(readback.readbackText?.en ?? ''), 'honest_get_readback_label', { calendarLabel: readback.calendarLabel, readbackText: readback.readbackText });
} catch (error) {
  report.error = error.message;
  report.status = transportLost || report.requests.filter(r => ['/api/ingest', '/api/query'].includes(r.path)).length === 0 ? 'BLOCKED' : 'FAIL';
  if (report.requests.some(r => r.path === '/api/confirm' && r.transportError)) report.confirmationOutcome = 'UNKNOWN; do not retry; lead reconciliation required';
} finally {
  if (!transportLost) {
    const after = await call('GET', '/api/runtime', null, 'runtime-after');
    report.runtimeAfter = after;
    await writeFile(join(output, 'runtime-after.json'), `${JSON.stringify({ capturedAt: after.completedAt, ...after }, null, 2)}\n`);
    const b = unwrap(beforeRuntime?.body)?.sourceSnapshot, a = unwrap(after.body)?.sourceSnapshot;
    report.provenance = { loadedHashStable: b?.serverLoaded?.sha256 === a?.serverLoaded?.sha256,
      startedAtStable: b?.serverLoaded?.startedAt === a?.serverLoaded?.startedAt,
      serverCurrentAtEnd: a?.serverCurrent, uiHashStable: b?.uiOnDisk?.sha256 === a?.uiOnDisk?.sha256,
      runtimeVersion: unwrap(after.body)?.version, before: b, after: a };
  }
  report.completedAt = new Date().toISOString();
  report.scores = { ambiguityPassed: report.questions.filter(q => q.kind === 'ambiguity' && q.status === 'PASS').length, ambiguityTotal: 2,
    absentFactPassed: report.questions.filter(q => q.kind === 'absent-fact' && q.status === 'PASS').length, absentFactTotal: 3,
    modelEvidencePassed: report.modelEvidence.filter(m => m.status === 'PASS').length, modelEvidenceTotal: report.modelEvidence.length,
    localChecksPassed: report.localChecks.filter(c => c.status === 'PASS').length, localChecksTotal: report.localChecks.length,
    localCalendarPassed: Boolean(report.recordId) && !report.error && report.localChecks.every(c => c.status === 'PASS'),
    newModelRequests: report.requests.filter(r => ['/api/ingest', '/api/query'].includes(r.path)).length,
    inheritedModelEvidenceRecords: inherited?.modelEvidence.length ?? 0 };
  if (report.status === 'RUNNING') report.status = report.questions.every(q => q.status === 'PASS') && report.scores.localCalendarPassed
    && report.modelEvidence.every(m => m.status === 'PASS') ? 'PASS_FOR_TARGETED_API_AND_LOCAL_FILE' : 'FAIL';
  await save();
  console.log(JSON.stringify({ output, status: report.status, scores: report.scores, error: report.error, provenance: report.provenance,
    proposalId: report.proposalId, recordId: report.recordId, confirmationOutcome: report.confirmationOutcome }, null, 2));
  process.exitCode = report.status === 'PASS_FOR_TARGETED_API_AND_LOCAL_FILE' ? 0 : report.status === 'BLOCKED' ? 2 : 1;
}
