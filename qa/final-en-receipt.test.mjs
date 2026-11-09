// SYNTHETIC validator fixtures only; no live model/browser/calendar/server calls or writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { validateFinalReceipt } from './validate-final-en-receipt.mjs';
import { loadScenarios } from './run-heldout.mjs';

async function fixture() {
  const receipt = JSON.parse(await readFile(new URL('./final-en-receipt.template.json', import.meta.url), 'utf8'));
  receipt.runId = 'SYNTHETIC-RECEIPT-SELFTEST-NOT-LIVE';
  receipt.independentReviewer = 'independent-test-reviewer';
  const files = new Map();
  const set = (id, value, kind = receipt.artifacts[id]?.kind ?? 'json', producer = receipt.artifacts[id]?.producer ?? 'sj-qa') => {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(kind === 'json' ? JSON.stringify(value) : value);
    const path = `qa/evidence/SYNTHETIC-IN-MEMORY-ONLY/${id}`;
    files.set(path, bytes);
    receipt.artifacts[id] = { path, kind, producer, sha256: createHash('sha256').update(bytes).digest('hex') };
  };
  const json = id => JSON.parse(files.get(receipt.artifacts[id].path).toString());
  const loadArtifact = async spec => { if (!files.has(spec.path)) throw new Error('Missing synthetic artifact'); return files.get(spec.path); };
  set('notes', 'Synthetic receipt validator test observations, not real acceptance evidence.', 'text');
  for (const gate of receipt.gates) Object.assign(gate, { status: 'PASS', reviewedBy: 'sj-qa', evidence: ['notes'], details: {} });
  const details = id => receipt.gates.find(g => g.id === id).details;
  Object.assign(details('EN_DEFAULT'), { freshStorage: true, manualToggle: false, renderedLang: 'en', optionalKo: true, navigatorLocale: 'ko-KR', url: 'http://127.0.0.1:8787/ui/?api=live', apiMode: 'live' });
  Object.assign(details('EN_FLOW_COPY_VOICE'), { naturalEnglishReviewed: true, textAlternative: true, capabilityLabelsHonest: true, timezoneVisible: true, voiceStatus: 'unverified' });
  set('gap', 'TAP version 13\nok 1 - GAP-1\nok 2 - GAP-2\n# tests 12\n# pass 12\n# fail 0\n', 'tap');
  Object.assign(details('GAP12_SYNTHETIC'), { tapArtifact: 'gap', modelKind: 'synthetic-fake-llm' });
  set('candidates', { when: { candidates: [{ date: '2027-02-16', startIso: '2027-02-16T07:00:00+09:00' }, { date: '2027-02-16', startIso: '2027-02-16T19:00:00+09:00' }] } });
  Object.assign(details('GAP3_OBJECT_CANDIDATE'), { candidateArtifact: 'candidates', candidatePointer: '/when/candidates', selectedIso: '2027-02-16T19:00:00+09:00', datePreserved: true, ampmInitiallyUnselected: true, explicitChoice: true });
  Object.assign(details('CONFIRM_BINDING'), { digestBound: true, revisionBound: true, editRevokesConfirmation: true, consequentialReadbackEnglish: true });
  const expected = { title: 'Synthetic validator event', startsAt: '2027-02-16T19:00:00+09:00', who: 'Nikhil', where: 'Greenhouse', reminders: [60] };
  set('record', { adapterId: 'calendar.local', mode: 'real', status: 'completed', verifyLevel: 'api_readback', intentId: 'test-intent', revision: 2, readback: expected });
  set('disk', { events: [{ ...expected, start: expected.startsAt.slice(0, 16), intentId: 'test-intent', revision: 2, location: expected.where }] });
  Object.assign(details('LOCAL_CALENDAR_READBACK'), { recordArtifact: 'record', diskArtifact: 'disk', expected, phoneCalendarClaim: false, notificationClaim: 'in-app-only' });
  Object.assign(details('CANCEL_IDEMPOTENCY'), { staleConfirmRejected: true, duplicateWrites: 0, sameRecordOnDuplicate: true, cancelledEntryAbsentOnReadback: true, cancelledReminderCount: 0 });
  Object.assign(details('ERROR_HONESTY'), { permissionFailureNoSuccess: true, preSendRetryOnly: true, postSendRetryDisabled: true, reconciliationRequired: true, mismatchNoSuccess: true });
  Object.assign(details('MOBILE_390'), { viewport: { width: 390, height: 844 }, overflow: ['input', 'memory', 'ask', 'clarify', 'confirm', 'result', 'plans', 'privacy', 'error'].map(screen => ({ screen, scrollWidth: 390, clientWidth: 390 })) });
  Object.assign(details('KEYBOARD_TARGETS_ZOOM'), { keyboardFlow: true, focusVisible: true, dialogFocusRestored: true, minTargetWidth: 48, minTargetHeight: 48, zoom150: true, zoom200: true, zoomNoClipping: true });
  Object.assign(details('REDUCED_MOTION'), { prefersReducedMotion: true, nonessentialMotionDisabled: true, progressStillUsable: true });
  // Tiny test PNG is only a signature fixture. It is not a screenshot or live-capture claim.
  set('image', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aEv8AAAAASUVORK5CYII=', 'base64'), 'image', 'parent-Aside');
  receipt.gates.find(g => g.id === 'RAW_CAPTURE').evidence.push('image');
  Object.assign(details('RAW_CAPTURE'), { producer: 'parent-Aside', raw: true, mockup: false, linkedRunId: receipt.runId, apiMode: 'live' });
  const snapshot = { serverCurrent: true, serverLoaded: { sha256: 'a'.repeat(64), startedAt: '2026-11-09T03:00:00Z' }, serverOnDisk: { sha256: 'a'.repeat(64) }, uiOnDisk: { sha256: 'b'.repeat(64) } };
  set('before', { capturedAt: '2026-11-09T03:00:00Z', httpStatus: 200, body: { ok: true, data: { version: 'selftest-only', sourceSnapshot: snapshot } } });
  set('after', { capturedAt: '2026-11-09T03:03:00Z', httpStatus: 200, body: { ok: true, data: { version: 'selftest-only', sourceSnapshot: snapshot } } });
  receipt.runtime = { before: 'before', after: 'after' };
  const [, scenario] = await loadScenarios();
  const utterances = scenario.text.split(/\r?\n/).map((line, i) => ({ id: `test-${i}`, text: line.slice(line.indexOf(':') + 1).trim() }));
  const ref = quote => { const u = utterances.find(u => u.text.includes(quote)); const start = u.text.indexOf(quote); return { utteranceId: u.id, quote, charStart: start, charEnd: start + quote.length }; };
  const route = { id: 'cursor-cli', model: 'validator-test-model', cached: false, ms: 1 };
  const response = data => ({ httpStatus: 200, elapsedMs: 2, body: { ok: true, data: { ...data, mode: 'model', route,
    telemetry: { mode: 'model', route, rawModelJson: data.sessionId ? { items: [] } : { found: data.found, slots: {}, memoryIds: [], asked: [] }, validation: { ok: true, rejected: 0 }, rejected: 0,
      modelCalls: [{ ok: true, route: route.id, model: route.model, cached: false, ms: 1 }] } } } });
  const requests = [{ scenarioId: scenario.id, path: '/api/ingest', payload: { text: scenario.text }, response: response({ sessionId: 'test-session', utterances }) }];
  for (const question of scenario.questions) {
    const answer = { found: question.rule !== 'unknown', slots: Object.fromEntries(['who', 'when', 'where', 'what'].map(k => [k, { state: 'unknown', uncertainty: 'unknown', value: null, evidence: [] }])) };
    if (question.rule === 'contains') answer.slots.who = { state: 'known', uncertainty: 'stated', value: 'Nikhil', evidence: [ref(question.evidenceMustContain)] };
    if (question.rule === 'ambiguous') answer.slots.when = { state: 'ambiguous', uncertainty: 'ambiguous', value: null, evidence: [ref(question.evidenceMustContain)], clarification: { en: 'AM or PM?' } };
    requests.push({ scenarioId: scenario.id, path: '/api/query', questionId: question.id, response: response(answer) });
  }
  set('live', { startedAt: '2026-11-09T03:01:00Z', completedAt: '2026-11-09T03:02:00Z', scenarios: [{ id: scenario.id, lang: 'en', expected: scenario.questions }], requests });
  receipt.live = { report: 'live', scenarioIds: [scenario.id] };
  return { receipt, files, set, json, details, validate: () => validateFinalReceipt(receipt, { loadArtifact }) };
}

test('empty prepared template stays BLOCKED, never accepted', async () => {
  const template = JSON.parse(await readFile(new URL('./final-en-receipt.template.json', import.meta.url), 'utf8'));
  const result = await validateFinalReceipt(template, { loadArtifact: async () => { throw new Error('No files expected'); } });
  assert.equal(result.status, 'BLOCKED'); assert.equal(result.errors.length, 0); assert.equal(result.gatesPassed, 0);
});
test('complete SYNTHETIC receipt passes checker structure only, not a live evidence claim', async () => { assert.equal((await (await fixture()).validate()).status, 'PASS'); });
test('artifact tamper fails checksum', async () => { const f = await fixture(); f.files.set(f.receipt.artifacts.notes.path, Buffer.from('tampered')); assert.equal((await f.validate()).status, 'FAIL'); });
test('manual English override and sample mode cannot prove English default', async () => {
  for (const change of [{ manualToggle: true }, { url: 'http://127.0.0.1:8787/ui/?lang=en' }, { apiMode: 'fixture' }]) { const f = await fixture(); Object.assign(f.details('EN_DEFAULT'), change); assert.equal((await f.validate()).status, 'FAIL'); }
});
test('GAP12 cannot be 10/12 or relabelled live', async () => { const f = await fixture(); f.set('gap', '# tests 12\n# pass 10\n# fail 2\nGAP-1 GAP-2', 'tap'); assert.equal((await f.validate()).status, 'FAIL'); });
test('GAP3 string candidates do not replace object candidate integration', async () => { const f = await fixture(); f.set('candidates', { when: { candidates: ['2027-02-16T07:00:00+09:00', '2027-02-16T19:00:00+09:00'] } }); assert.equal((await f.validate()).status, 'FAIL'); });
test('missing raw telemetry, fallback and model-call attribution mismatch fail', async () => {
  for (const mutation of ['raw', 'fallback', 'attribution']) { const f = await fixture(); const live = f.json('live'); const data = live.requests[0].response.body.data;
    if (mutation === 'raw') data.telemetry.rawModelJson = null;
    if (mutation === 'fallback') data.mode = 'fallback';
    if (mutation === 'attribution') data.telemetry.modelCalls[0].ms = 99;
    f.set('live', live); assert.equal((await f.validate()).status, 'FAIL'); }
});
test('stale/changed source hash or unbracketed runtime cannot pass', async () => {
  for (const mutation of ['stale', 'ui', 'time']) { const f = await fixture(); const after = f.json('after');
    if (mutation === 'stale') after.body.data.sourceSnapshot.serverCurrent = false;
    if (mutation === 'ui') after.body.data.sourceSnapshot.uiOnDisk.sha256 = 'c'.repeat(64);
    if (mutation === 'time') after.capturedAt = '2026-11-09T03:00:30Z';
    f.set('after', after); assert.equal((await f.validate()).status, 'FAIL'); }
});
test('simulated/ICS completion or wrong disk readback cannot claim real local save', async () => {
  for (const mutation of ['simulated', 'ics', 'disk']) { const f = await fixture();
    if (mutation === 'disk') { const disk = f.json('disk'); disk.events[0].startsAt = '2027-02-16T20:00:00+09:00'; f.set('disk', disk); }
    else { const record = f.json('record'); if (mutation === 'simulated') record.mode = 'simulated'; else record.adapterId = 'calendar.ics-handoff'; f.set('record', record); }
    assert.equal((await f.validate()).status, 'FAIL'); }
});
test('mobile overflow, tiny targets, zoom clipping or missing reduced motion fails', async () => {
  for (const mutation of ['overflow', 'targets', 'zoom', 'motion']) { const f = await fixture();
    if (mutation === 'overflow') f.details('MOBILE_390').overflow[0].scrollWidth = 500;
    if (mutation === 'targets') f.details('KEYBOARD_TARGETS_ZOOM').minTargetWidth = 20;
    if (mutation === 'zoom') f.details('KEYBOARD_TARGETS_ZOOM').zoomNoClipping = false;
    if (mutation === 'motion') f.details('REDUCED_MOTION').nonessentialMotionDisabled = false;
    assert.equal((await f.validate()).status, 'FAIL'); }
});
test('lead smoke report cannot be relabelled independent QA', async () => { const f = await fixture(); f.receipt.artifacts.live.producer = 'senior-planner'; assert.equal((await f.validate()).status, 'FAIL'); });
test('found=true for unknown still fails even with complete telemetry', async () => { const f = await fixture(); const live = f.json('live'); live.requests.at(-1).response.body.data.found = true; f.set('live', live); assert.equal((await f.validate()).status, 'FAIL'); });
test('mockup capture and non-image bytes cannot satisfy raw proof', async () => {
  const f = await fixture(); f.details('RAW_CAPTURE').mockup = true; f.set('image', Buffer.from('<svg>fake screenshot</svg>'), 'image', 'parent-Aside'); assert.equal((await f.validate()).status, 'FAIL');
});
test('maker cannot approve own gate; absent final reviewer stays blocked', async () => {
  const f = await fixture(); f.receipt.gates[0].reviewedBy = f.receipt.gates[0].owner; assert.equal((await f.validate()).status, 'FAIL');
  const g = await fixture(); g.receipt.independentReviewer = null; assert.equal((await g.validate()).status, 'BLOCKED');
});
test('runtime error response is rejected even if it contains plausible source metadata', async () => {
  const f = await fixture(); const before = f.json('before'); before.httpStatus = 500; before.body.ok = false; f.set('before', before); assert.equal((await f.validate()).status, 'FAIL');
});
test('irrelevant raw JSON and impossible latency do not satisfy model evidence', async () => {
  for (const mutation of ['shape', 'latency', 'negative-rejected']) { const f = await fixture(); const live = f.json('live'); const response = live.requests[0].response;
    if (mutation === 'shape') response.body.data.telemetry.rawModelJson = { unrelated: 'not a model extraction' };
    if (mutation === 'latency') response.elapsedMs = 0;
    if (mutation === 'negative-rejected') { response.body.data.telemetry.validation.rejected = -1; response.body.data.telemetry.rejected = -1; }
    f.set('live', live); assert.equal((await f.validate()).status, 'FAIL'); }
});
test('telemetry cannot attribute a different response model to this call', async () => {
  const f = await fixture(); const live = f.json('live'); live.requests[0].response.body.data.route.model = 'different-model'; f.set('live', live); assert.equal((await f.validate()).status, 'FAIL');
});
test('canonical root live entry and explicit ui entry both count without language override', async () => {
  for (const url of ['http://127.0.0.1:8787/?api=live', 'http://127.0.0.1:8787/ui/?api=live']) {
    const f = await fixture(); f.details('EN_DEFAULT').url = url; assert.equal((await f.validate()).status, 'PASS');
  }
});
