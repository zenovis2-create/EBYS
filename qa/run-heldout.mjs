import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createConnection } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const QA_DIR = dirname(fileURLToPath(import.meta.url));
const BASE_URL = 'http://127.0.0.1:8787';
const SLOT_NAMES = ['who', 'when', 'where', 'what'];
const verdict = (status, detail) => ({ status, detail });
const sha256 = value => createHash('sha256').update(value).digest('hex');
const unwrap = body => body?.data && typeof body.data === 'object' ? body.data : body;

export async function loadScenarios() {
  return Promise.all(['ko', 'en'].map(async lang => {
    const expected = JSON.parse(await readFile(join(QA_DIR, 'heldout', `${lang}.expected.json`), 'utf8'));
    const text = (await readFile(join(QA_DIR, 'heldout', `${lang}.txt`), 'utf8')).trim();
    if (expected.lang !== lang || expected.provenance !== 'synthetic' || expected.questions.length !== 3
        || expected.questions.filter(q => q.rule === 'unknown').length !== 1
        || !text.split(/\r?\n/).every(line => /^[^:]+: .+$/u.test(line))) {
      throw new Error(`Invalid held-out fixture: ${lang}`);
    }
    return { ...expected, text, sha256: sha256(text) };
  }));
}

export function probeServer() {
  return new Promise(resolveProbe => {
    const socket = createConnection({ host: '127.0.0.1', port: 8787 });
    let done = false;
    const finish = result => {
      if (done) return;
      done = true;
      socket.destroy();
      resolveProbe(result);
    };
    socket.setTimeout(1500);
    socket.once('connect', () => finish({ up: true }));
    socket.once('timeout', () => finish({ up: false, error: 'TCP readiness timeout' }));
    socket.once('error', error => finish({ up: false, error: `${error.code}: ${error.message}` }));
  });
}

async function postJson(path, payload) {
  if (!['/api/ingest', '/api/query'].includes(path)) throw new Error('Endpoint outside QA scope');
  const started = performance.now();
  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(180_000),
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    });
    const raw = await response.text();
    let body;
    try { body = JSON.parse(raw); } catch { /* Preserve the original non-JSON body. */ }
    return { httpStatus: response.status, elapsedMs: Math.round(performance.now() - started), raw, body };
  } catch (error) {
    return { elapsedMs: Math.round(performance.now() - started), transportError: `${error.name}: ${error.message}` };
  }
}

function usable(response) {
  return !response.transportError && response.httpStatus >= 200 && response.httpStatus < 300
    && response.body && response.body.ok !== false && unwrap(response.body)?.ok !== false;
}

function evidenceError(ref, utterances, transcript) {
  if (!ref || typeof ref.quote !== 'string' || !ref.quote.trim()) return 'Empty evidence quote';
  const utterance = utterances.find(u => (u.id ?? u.utteranceId) === ref.utteranceId);
  if (!utterance || typeof utterance.text !== 'string') return 'Evidence utterance ID not in ingest response';
  if (!transcript.split(/\r?\n/).some(line => line.slice(line.indexOf(':') + 1).trim() === utterance.text.trim())) {
    return 'Evidence utterance text not in held-out transcript';
  }
  if (!Number.isInteger(ref.charStart) || !Number.isInteger(ref.charEnd) || ref.charStart < 0
      || ref.charEnd <= ref.charStart || ref.charEnd > utterance.text.length
      || utterance.text.slice(ref.charStart, ref.charEnd) !== ref.quote) return 'Evidence offsets/quote mismatch';
  return null;
}

export function evaluateAnswer(answer, question, utterances, transcript) {
  if (!answer || typeof answer.found !== 'boolean' || !answer.slots) return verdict('FAIL', 'Answer schema missing found/slots');
  const slots = SLOT_NAMES.map(name => answer.slots[name]);
  if (slots.some(slot => !slot || !['known', 'partial', 'ambiguous', 'unknown'].includes(slot.state)
      || !Array.isArray(slot.evidence))) return verdict('FAIL', 'Invalid or missing Slot state/evidence');
  for (const slot of slots) {
    if (slot.state !== 'unknown' && !slot.evidence.length) return verdict('FAIL', 'Non-unknown slot has no evidence');
    for (const ref of slot.evidence) {
      const error = evidenceError(ref, utterances, transcript);
      if (error) return verdict('FAIL', error);
    }
  }
  if (question.rule === 'unknown') {
    // Named event context is allowed; the answer itself must explicitly remain unavailable.
    if (answer.found !== false || slots.some(slot => slot.state === 'known' && slot.value != null)) {
      return verdict('FAIL', 'Unanswerable question returned found=true or a known answer slot');
    }
    return verdict('PASS', 'Unknown answer; no invented known slot');
  }
  const slot = answer.slots[question.slot];
  if (!slot.evidence.some(ref => ref.quote.includes(question.evidenceMustContain))) {
    return verdict('FAIL', 'Expected answer-specific source quote missing');
  }
  if (question.rule === 'ambiguous') {
    const clarification = answer.clarification ?? slot.clarification;
    if (slot.state !== 'ambiguous' || slot.uncertainty !== 'ambiguous' || !clarification) {
      return verdict('FAIL', 'AM/PM ambiguity or required clarification lost');
    }
    // Slot.value is intentionally unconstrained by CONTRACTS: retaining a known date
    // and unresolved hour is valid. Only a selected exact time/instant is forbidden.
    if (slot.value != null && (typeof slot.value !== 'object' || Array.isArray(slot.value)
        || slot.value.time != null || slot.value.startIso != null || slot.value.startsAt != null
        || slot.value.daypart != null)) return verdict('FAIL', 'Ambiguous time has a selected value');
    return verdict('PASS', 'AM/PM remains unresolved with evidence and clarification');
  }
  if (!answer.found || slot.state !== 'known' || slot.value == null) return verdict('FAIL', 'Expected known answer missing');
  const actual = question.rule === 'exact' && typeof slot.value === 'object'
    ? slot.value.startIso ?? slot.value.startsAt
    : typeof slot.value === 'string' ? slot.value : JSON.stringify(slot.value);
  if (typeof actual !== 'string') return verdict('FAIL', 'Exact answer has no verifiable instant');
  const matches = question.acceptedValues.some(expected => question.rule === 'exact'
    ? actual === expected : actual.toLocaleLowerCase().includes(expected.toLocaleLowerCase()));
  return matches ? verdict('PASS', 'Expected value and verbatim source verified') : verdict('FAIL', 'Answer differs from held-out expectation');
}

export function evaluateModelEvidence(body) {
  const data = unwrap(body);
  const telemetry = body?.telemetry ?? data?.telemetry ?? data;
  const route = telemetry?.route ?? data?.route;
  const routeId = typeof route === 'string' ? route : route?.id;
  const model = telemetry?.model ?? route?.model;
  const mode = data?.mode ?? telemetry?.mode;
  if (mode === 'fallback' || routeId === 'fallback-rules') return verdict('BLOCKED', 'Fallback only; does not establish Track A AI');
  const missing = [];
  if (mode !== 'model') missing.push('mode=model');
  if (!routeId) missing.push('route');
  if (!model) missing.push('model');
  if (telemetry?.rawModelJson == null) missing.push('rawModelJson');
  if (telemetry?.validation == null) missing.push('validation');
  if (!Number.isInteger(telemetry?.rejected ?? data?.rejected)) missing.push('rejected count');
  if (missing.length) return verdict('BLOCKED', `Required AI evidence missing: ${missing.join(', ')}`);
  if (!['cursor-cli', 'ollama-local', 'env-api', 'cli-alt'].includes(routeId)
      || /fake|mock|stub|fixture|synthetic/i.test(model)) return verdict('BLOCKED', 'Route/model not verified as a real model');
  if (telemetry.validation === false || telemetry.validation?.ok === false) return verdict('FAIL', 'Model validation reported failure');
  return verdict('PASS', `Server reports model route ${routeId}; raw JSON and validation retained (provider execution still subject to lead audit)`);
}

function aggregate(results) {
  return results.some(result => result.status === 'FAIL') ? 'FAIL'
    : results.some(result => result.status === 'BLOCKED') ? 'BLOCKED' : 'PASS';
}

export async function runHeldout({ probe = probeServer, request = postJson, save, clock = () => new Date() } = {}) {
  const startedAt = clock().toISOString();
  const scenarios = await loadScenarios();
  const report = {
    assignment: 'T21a', provenance: 'synthetic', baseUrl: BASE_URL, startedAt,
    node: process.version, runnerSha256: sha256(await readFile(fileURLToPath(import.meta.url))),
    reference: '../../test-plan.md and ../../CONTRACTS.md revision 2 sections 0, 1a, 6a, 6b',
    requests: [], scenarios: [], limitations: [
      'API-only test; no phone UI, action-confirmation, permission, deletion or notification acceptance.',
      'Injection non-execution and cancellation memory states require separate action-ledger/memory inspection; ingest/query responses alone cannot prove absence of side effects.',
      'Real provider execution requires lead audit of router/model evidence; reported route names alone are not proof.',
      'No action, confirm, cleanup, reset or deletion endpoints are called; synthetic sessions remain on the lead server.',
    ],
  };
  const writeReport = save ?? (async result => {
    const folder = join(QA_DIR, 'evidence', `${startedAt.replace(/[:.]/g, '-')}-${process.pid}`);
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, 'report.json'), `${JSON.stringify(result, null, 2)}\n`);
    return folder;
  });
  const readiness = await probe();
  report.readiness = readiness;
  if (!readiness.up) {
    report.status = 'BLOCKED';
    report.blocker = `Lead server unavailable: ${readiness.error}; no POST attempted`;
  } else {
    let transportLost = false;
    for (const scenario of scenarios) {
      const item = { id: scenario.id, lang: scenario.lang, sha256: scenario.sha256, expected: scenario.questions, checks: [] };
      report.scenarios.push(item);
      if (transportLost) {
        item.checks.push(verdict('BLOCKED', 'Transport lost earlier; no further POST attempted'));
        continue;
      }
      const payload = { title: `T21a ${scenario.id} SYNTHETIC ${startedAt}`, text: scenario.text, lang: scenario.lang, provenance: 'synthetic' };
      const ingestion = await request('/api/ingest', payload);
      report.requests.push({ scenarioId: scenario.id, path: '/api/ingest', payload, response: ingestion });
      if (!usable(ingestion)) {
        transportLost = Boolean(ingestion.transportError);
        item.checks.push(verdict(transportLost || ingestion.httpStatus >= 500 ? 'BLOCKED' : 'FAIL', 'Ingest unavailable or rejected; queries skipped; inspect raw response'));
        continue;
      }
      const data = unwrap(ingestion.body);
      item.sessionId = data.sessionId;
      item.checks.push({ name: 'model evidence', ...evaluateModelEvidence(ingestion.body) });
      if (!data.sessionId || !Array.isArray(data.utterances)) {
        item.checks.push(verdict('FAIL', 'Ingest contract missing sessionId/utterances; queries skipped'));
        continue;
      }
      for (const question of scenario.questions) {
        const query = { text: question.text, lang: scenario.lang };
        const response = await request('/api/query', query);
        report.requests.push({ scenarioId: scenario.id, questionId: question.id, path: '/api/query', payload: query, response });
        if (!usable(response)) {
          transportLost = Boolean(response.transportError);
          item.checks.push({ questionId: question.id, ...verdict(transportLost || response.httpStatus >= 500 ? 'BLOCKED' : 'FAIL', 'Query unavailable/rejected; inspect raw response') });
          if (transportLost) break;
          continue;
        }
        item.checks.push({ questionId: question.id, ...evaluateAnswer(unwrap(response.body), question, data.utterances, scenario.text) });
      }
    }
    report.status = aggregate(report.scenarios.flatMap(scenario => scenario.checks));
  }
  report.completedAt = clock().toISOString();
  const evidenceDir = await writeReport(report);
  return { report, evidenceDir };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { report, evidenceDir } = await runHeldout();
    console.log(JSON.stringify({ status: report.status, requests: report.requests.length, evidenceDir, blocker: report.blocker,
      scenarios: report.scenarios.map(s => ({ id: s.id, checks: s.checks })) }, null, 2));
    process.exitCode = report.status === 'PASS' ? 0 : report.status === 'BLOCKED' ? 2 : 1;
  } catch (error) {
    console.error(`QA runner error: ${error.message}`);
    process.exitCode = 1;
  }
}
