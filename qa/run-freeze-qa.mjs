// Signal-gated QA. Preparation/import/--plan performs no HTTP or model calls.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadScenarios, evaluateAnswer, evaluateModelEvidence } from './run-heldout.mjs';
import { parseFreezeSignal, freezeErrors, authorizeScopedDelete, receiptErrors, sourceValueErrors, modelBudgetMs } from './freeze-policy.mjs';

const qa = dirname(fileURLToPath(import.meta.url)), project = resolve(qa, '..');
const digest = value => createHash('sha256').update(value).digest('hex');
const data = response => response?.body?.data ?? response?.body;
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const START = '2027-04-19T14:30:00+09:00', PLACE = 'Glass Meadow workshop';
export const PLAN = Object.freeze({ scope: 'two AM/PM + three absent facts + source/confirm/cancel/local-readback + owned-session cleanup',
  plannedSerialModelRequests: 9, automaticModelRetries: 0, deadlineKst: '2026-11-09 14:45', requires: 'LEAD-READY-FREEZE <server sha12> <ui sha12>',
  prepHttpCalls: 0, deletionPayload: '{sessionId} only; this-run ownership and same-backend checks mandatory' });

export async function runFreeze({ signal, fetchImpl = globalThis.fetch } = {}) {
  const expected = parseFreezeSignal(signal); // No IO/network is reached without a real-shaped explicit signal.
  const nonce = randomBytes(6).toString('hex'), runId = `freeze-${nonce}`, startedAt = new Date().toISOString();
  const out = join(qa, 'evidence', `${runId}-${startedAt.replace(/[:.]/g, '-')}`);
  await mkdir(out, { recursive: true });
  const deadline = Date.parse('2026-11-09T14:45:00+09:00');
  const report = { runId, producer: 'sj-qa', signal, expected, startedAt, plan: PLAN, status: 'RUNNING',
    runnerSha256: digest(await readFile(fileURLToPath(import.meta.url))), requests: [], checks: [], ownedSessions: [], deletionReceipts: [] };
  const owned = new Map(), memories = new Set(), utterances = new Set(), proposals = new Set(), recordIds = new Set(), fileUids = new Set();
  let anchor, baselineMemories = [], baselineEvents = [], blocked = false;
  const save = () => writeFile(join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  const check = (id, ok, detail) => { report.checks.push({ id, status: ok ? 'PASS' : 'FAIL', detail }); return ok; };
  const must = (id, ok, detail) => { if (!check(id, ok, detail)) throw new Error(`Guard failed: ${id}`); };
  async function fileSnapshot(label) {
    let raw, value;
    try { raw = await readFile(join(project, '.data/calendar.json'), 'utf8'); value = JSON.parse(raw); }
    catch (error) { if (error.code !== 'ENOENT') throw error; raw = null; value = { events: [] }; }
    const evidence = { source: '.data/calendar.json', readAt: new Date().toISOString(), sha256: raw == null ? null : digest(raw), eventCount: value.events.length,
      events: value.events.filter(e => fileUids.has(e.uid)), otherEventHashes: value.events.filter(e => !fileUids.has(e.uid)).map(e => ({ uid: e.uid, sessionId: e.sessionId, sha256: digest(JSON.stringify(e)) })) };
    await writeFile(join(out, `${label}.json`), `${JSON.stringify(evidence, null, 2)}\n`);
    return value;
  }
  async function api(method, path, payload, caseId) {
    const model = ['/api/ingest', '/api/query'].includes(path);
    const allowed = method === 'GET' ? ['/api/runtime', '/api/memories', '/api/records'].includes(path) || /^\/api\/readback\/[^/]+$/.test(path)
      : ['/api/ingest', '/api/query', '/api/propose', '/api/preview', '/api/confirm', '/api/delete'].includes(path) || /^\/api\/proposal\/[^/]+(?:\/cancel)?$/.test(path);
    if (!allowed || (blocked && model)) throw new Error('Endpoint/model call not allowed');
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw new Error('14:45 deadline reached; no new request permitted');
    const timeoutMs = model ? modelBudgetMs(Date.now(), deadline) : Math.min(10000, remainingMs);
    if (path === '/api/delete') {
      const protectedIds = new Set(baselineEvents.map(e => e.sessionId).filter(Boolean));
      authorizeScopedDelete(payload, owned, report.cleanupRuntime, anchor, runId, protectedIds);
    }
    if (path === '/api/propose' && !memories.has(payload?.memoryId)) throw new Error('Cannot propose an unowned memory');
    if (['/api/preview', '/api/confirm'].includes(path) && !proposals.has(payload?.proposalId)) throw new Error('Cannot use an unowned proposal');
    const proposalMatch = /^\/api\/proposal\/([^/]+)/.exec(path);
    if (proposalMatch && !proposals.has(decodeURIComponent(proposalMatch[1]))) throw new Error('Cannot alter/cancel an unowned proposal');
    const r = { method, path, caseId, requestedAt: new Date().toISOString(), ...(payload ? { payload } : {}) };
    const start = performance.now();
    try {
      const response = await fetchImpl(`http://127.0.0.1:8787${path}`, { method, redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
        ...(payload ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) } : {}) });
      r.httpStatus = response.status; r.raw = await response.text();
      try { r.body = JSON.parse(r.raw); } catch { /* Original failure preserved. */ }
    } catch (error) { r.transportError = `${error.name}: ${error.message}`; blocked = true; }
    r.elapsedMs = Math.round(performance.now() - start); r.completedAt = new Date().toISOString();
    report.requests.push(r); await save();
    console.log(JSON.stringify({ caseId, method, path, httpStatus: r.httpStatus, elapsedMs: r.elapsedMs, route: data(r)?.telemetry?.route ?? data(r)?.route, error: r.transportError }));
    return r;
  }
  function ok(r) { if (r.httpStatus !== 200 || r.body?.ok === false || r.transportError) throw new Error(`Request unavailable: ${r.caseId}`); return data(r); }
  async function freezePoint(label) {
    const r = await api('GET', '/api/runtime', null, label), rt = ok(r);
    await writeFile(join(out, `${label}.json`), `${JSON.stringify({ capturedAt: r.completedAt, ...r }, null, 2)}\n`);
    const errors = freezeErrors(rt, expected, anchor);
    must(label, !errors.length, { errors, version: rt.version, sourceSnapshot: rt.sourceSnapshot });
    anchor ??= rt;
    return rt;
  }
  async function ingest(id, text, lang) {
    await freezePoint(`runtime-${id}`);
    const title = `sj-qa ${runId} ${id}`;
    const r = await api('POST', '/api/ingest', { title, text, lang, provenance: 'synthetic' }, `${id}/ingest`), d = ok(r);
    must(`${id}/ownership`, d.duplicate !== true && typeof d.sessionId === 'string' && d.utterances?.length
      && d.utterances.every(u => u.sessionId === d.sessionId), { sessionId: d.sessionId, duplicate: d.duplicate });
    const entry = { sessionId: d.sessionId, runId, createdHere: true, duplicate: false, title, requestSha256: digest(JSON.stringify(r.payload)), memoryIds: d.memoryIds, utteranceIds: d.utterances.map(u => u.id) };
    owned.set(d.sessionId, entry); report.ownedSessions.push(entry);
    for (const id of d.memoryIds ?? []) memories.add(id);
    for (const u of d.utterances) utterances.add(u.id);
    await save(); // Persist ownership before any later assertion can fail.
    must(`${id}/model-evidence`, evaluateModelEvidence(r.body).status === 'PASS' && d.telemetry?.route?.cached === false, d.telemetry);
    return d;
  }
  async function safeProposal(memoryId) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const p = ok(await api('POST', '/api/propose', { memoryId }, 'safety/propose')); proposals.add(p.id);
      const uid = `sj-${digest(String(p.id)).slice(0, 24)}@ebys.local`;
      if (!(await fileSnapshot('calendar-before-proposal')).events.some(e => e.uid === uid || e.intentId === p.id)) { fileUids.add(uid); return p; }
      // Never risk an expected-refusal probe overwriting an older file event with a reused prop ID.
      ok(await api('POST', `/api/proposal/${encodeURIComponent(p.id)}/cancel`, {}, 'safety/cancel-colliding-own-proposal'));
    }
    throw new Error('No unused proposal identity within bounded allocation; do not overwrite baseline calendar');
  }
  async function refusedConfirm(p, previewDigest, code, label) {
    const before = await fileSnapshot(`${label}-before`);
    const r = await api('POST', '/api/confirm', { proposalId: p.id, previewDigest }, label);
    if (data(r)?.intentId === p.id && data(r)?.recordId) recordIds.add(data(r).recordId);
    const after = await fileSnapshot(`${label}-after`);
    must(label, r.httpStatus === 400 && data(r)?.error?.code === code && same(before.events, after.events), r.body);
  }
  try {
    await freezePoint('runtime-before');
    baselineMemories = ok(await api('GET', '/api/memories', null, 'baseline/memories')).memories;
    baselineEvents = (await fileSnapshot('calendar-baseline')).events;
    const [ko, en] = await loadScenarios();
    const english = { id: 'english-first', lang: 'en', text: (await readFile(join(qa, 'english-first/conversation.txt'), 'utf8')).trim(),
      questions: JSON.parse(await readFile(join(qa, 'english-first/expected.json'), 'utf8')).questions.filter(q => ['ambiguous-swap', 'unknown-equipment'].includes(q.id)) };
    for (const group of [{ ...en, questions: en.questions.filter(q => ['ambiguous-time', 'unanswerable'].includes(q.id)) }, { ...ko, questions: ko.questions.filter(q => q.id === 'unanswerable') }, english]) {
      const ingested = await ingest(group.id, group.text, group.lang);
      for (const q of group.questions) {
        const r = await api('POST', '/api/query', { text: q.text, lang: group.lang }, `${group.id}/${q.id}`), answer = ok(r);
        check(`${group.id}/${q.id}/model`, evaluateModelEvidence(r.body).status === 'PASS', answer.telemetry);
        const results = (q.checks ?? [q]).map(c => evaluateAnswer(answer, c, ingested.utterances, group.text));
        check(`${group.id}/${q.id}`, results.every(v => v.status === 'PASS') && !sourceValueErrors(answer).length, { results, sourceValueErrors: sourceValueErrors(answer) });
        if (q.rule === 'ambiguous' || q.id === 'ambiguous-swap') {
          must('ambiguous-memory-owned', memories.has(answer.memoryId), { memoryId: answer.memoryId });
          const p = await safeProposal(answer.memoryId), pv = ok(await api('POST', '/api/preview', { proposalId: p.id }, 'safety/ambiguous-preview'));
          must('ambiguous-preview-needs-info', Boolean(pv.needs_clarification), pv);
          await refusedConfirm(p, 'no-exact-time-no-consent', 'needs_clarification', `safety/ambiguous-confirm-${p.id}`);
          ok(await api('POST', `/api/proposal/${encodeURIComponent(p.id)}/cancel`, {}, 'safety/cancel-own-ambiguous-proposal'));
        }
      }
    }
    const localText = (await readFile(join(qa, 'local-calendar/independent-230.txt'), 'utf8')).trim();
    const local = await ingest('local', localText, 'en');
    const current = ok(await api('GET', '/api/memories', null, 'local/memories')).memories;
    const choices = current.filter(m => local.memoryIds.includes(m.id) && (m.sessionId ?? m.meta?.sessionId) === local.sessionId && m.kind === 'event' && m.status === 'candidate');
    must('local-one-source-memory', choices.length === 1, { count: choices.length });
    const memory = choices[0], answer = { found: true, slots: { who: memory.who, when: memory.when, where: memory.where, what: memory.what } };
    const exact = evaluateAnswer(answer, { slot: 'when', rule: 'exact', acceptedValues: [START, '2027-04-19T05:30:00Z'], evidenceMustContain: '2:30 PM' }, local.utterances, localText);
    must('local-source-value-230', exact.status === 'PASS' && !sourceValueErrors(answer).length && memory.where?.value?.name === PLACE && JSON.stringify(memory.who?.value).includes('Kai'), { exact, sourceValueErrors: sourceValueErrors(answer) });
    let p = await safeProposal(memory.id), pv = ok(await api('POST', '/api/preview', { proposalId: p.id }, 'local/cancel-test-preview'));
    ok(await api('POST', `/api/proposal/${encodeURIComponent(p.id)}/cancel`, {}, 'local/cancel-exact-proposal'));
    await refusedConfirm(p, pv.previewDigest, 'proposal_closed', 'local/cancelled-confirm-refused');
    p = await safeProposal(memory.id); pv = ok(await api('POST', '/api/preview', { proposalId: p.id }, 'local/old-preview'));
    must('local-original-preview-230', pv.preview?.fields?.startsAt === START, pv);
    const changedReminders = pv.preview.fields.reminders.length ? [] : [60];
    const edited = ok(await api('POST', `/api/proposal/${encodeURIComponent(p.id)}`, { patch: { remindOffsetsMin: changedReminders } }, 'local/edit-reminders-revoke-consent'));
    must('local-edit-revision-changed', edited.revision > p.revision, { before: p.revision, after: edited.revision });
    await refusedConfirm(p, pv.previewDigest, 'stale_preview', 'local/stale-preview-refused');
    pv = ok(await api('POST', '/api/preview', { proposalId: p.id }, 'local/review-current-preview'));
    must('local-preview-scope', pv.mode === 'real' && pv.adapterId === 'calendar.local' && pv.preview.fields.startsAt === START
      && /EBYS calendar on this device/i.test(pv.preview.modeLabel?.en ?? '') && /not your phone calendar/i.test(pv.preview.modeLabel?.en ?? ''), pv);
    await freezePoint('runtime-preconfirm');
    report.explicitConfirmation = { proposalId: p.id, previewDigest: pv.previewDigest, fields: pv.preview.fields, reviewedAt: new Date().toISOString(), actor: 'sj-qa', scope: 'synthetic EBYS-local event only' }; await save();
    const rec = ok(await api('POST', '/api/confirm', { proposalId: p.id, previewDigest: pv.previewDigest }, 'local/confirm')); recordIds.add(rec.recordId);
    const rb = ok(await api('GET', `/api/readback/${encodeURIComponent(rec.recordId)}`, null, 'local/readback'));
    const cal = await fileSnapshot('calendar-verified-before-cleanup'), target = cal.events.filter(e => e.intentId === p.id);
    must('local-completed-readback', rec.status === 'completed' && rb.status === 'completed' && rec.verifyLevel === 'api_readback' && rb.verifyLevel === 'api_readback'
      && rec.displayState === 'completed_external' && rb.displayState === 'completed_external' && target.length === 1, { rec, rb, target });
    for (const key of ['title', 'startsAt', 'who', 'where', 'reminders']) {
      const disk = key === 'where' ? target[0].location : target[0][key];
      must(`local-match-${key}`, same(disk, pv.preview.fields[key]) && same(disk, rec.readback?.[key]) && same(disk, rb.readback?.[key]), { expected: pv.preview.fields[key], disk });
    }
    must('local-minute-and-session-link', target[0].start === START.slice(0, 16) && target[0].sessionId === local.sessionId, { event: target[0], sessionId: local.sessionId });
    const duplicate = ok(await api('POST', '/api/confirm', { proposalId: p.id, previewDigest: pv.previewDigest }, 'local/idempotent-confirm'));
    const calAgain = await fileSnapshot('calendar-after-duplicate');
    must('idempotent-confirm-one-write', duplicate.recordId === rec.recordId && calAgain.events.filter(e => e.intentId === p.id).length === 1 && same(cal.events, calAgain.events), duplicate);
  } catch (error) { report.error = error.message; report.checks.push({ id: 'execution', status: 'FAIL', detail: error.message }); }
  finally {
    for (const [sessionId] of owned) {
      try {
        report.cleanupRuntime = ok(await api('GET', '/api/runtime', null, `cleanup/runtime-${sessionId}`));
        const r = await api('POST', '/api/delete', { sessionId }, `cleanup/delete-${sessionId}`), receipt = ok(r);
        report.deletionReceipts.push({ sessionId, responseIndex: report.requests.length - 1, receipt });
        check(`cleanup/receipt-${sessionId}`, !receiptErrors(receipt, sessionId).length, receiptErrors(receipt, sessionId));
      } catch (error) { report.deletionReceipts.push({ sessionId, status: 'FAILED_OR_UNSAFE_TO_DELETE', error: error.message }); check(`cleanup/${sessionId}`, false, error.message); }
    }
    try {
      const remaining = ok(await api('GET', '/api/memories', null, 'cleanup/remaining-memories')).memories;
      const records = ok(await api('GET', '/api/records', null, 'cleanup/remaining-records')).records;
      const cal = await fileSnapshot('calendar-after-cleanup');
      check('cleanup/no-own-memories', !remaining.some(m => memories.has(m.id) || owned.has(m.sessionId ?? m.meta?.sessionId) || m.evidence?.some(e => utterances.has(e.utteranceId))), remaining.filter(m => memories.has(m.id)));
      check('cleanup/no-own-action-records', !records.some(r => recordIds.has(r.recordId) || proposals.has(r.intentId)), records.filter(r => recordIds.has(r.recordId)));
      check('cleanup/no-own-file-events', !cal.events.some(e => fileUids.has(e.uid)), cal.events.filter(e => fileUids.has(e.uid)));
      check('cleanup/other-memories-preserved', baselineMemories.every(old => remaining.some(m => m.id === old.id && same(m, old))), { baselineCount: baselineMemories.length });
      check('cleanup/other-file-events-preserved', baselineEvents.every(old => cal.events.some(e => e.uid === old.uid && same(e, old))), { baselineCount: baselineEvents.length });
      await freezePoint('runtime-after');
    } catch (error) { check('cleanup/final-verification', false, error.message); }
    report.completedAt = new Date().toISOString();
    report.status = report.checks.every(c => c.status === 'PASS') && owned.size === 4 && report.deletionReceipts.length === 4 ? 'PASS' : 'FAIL';
    report.scores = { checksPassed: report.checks.filter(c => c.status === 'PASS').length, checksTotal: report.checks.length,
      ownedSessions: owned.size, deletionReceipts: report.deletionReceipts.length, modelRequests: report.requests.filter(r => ['/api/ingest', '/api/query'].includes(r.path)).length };
    await save();
    console.log(JSON.stringify({ evidenceDir: out, status: report.status, scores: report.scores, error: report.error }, null, 2));
    console.log(`QA idle ${report.status}`);
  }
  return { report, evidenceDir: out };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--plan')) console.log(JSON.stringify({ status: 'PREPARED_NOT_EXECUTED', ...PLAN }, null, 2));
  else {
    const signalAt = process.argv.indexOf('--signal');
    if (signalAt < 0) { console.log('WAITING_FOR_LEAD_READY_FREEZE; no HTTP/model/delete calls'); process.exitCode = 2; }
    else try { const { report } = await runFreeze({ signal: process.argv[signalAt + 1] }); process.exitCode = report.status === 'PASS' ? 0 : 1; }
    catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
