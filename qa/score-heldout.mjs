// Offline scoring only: reads an existing QA report; never contacts the shared server.
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { evaluateAnswer } from './run-heldout.mjs';

const qaDir = dirname(fileURLToPath(import.meta.url));
const evidenceRoot = resolve(qaDir, 'evidence');
const reportPath = resolve(process.argv[2] ?? '');
const rel = relative(evidenceRoot, reportPath);
if (!rel || rel.startsWith(`..${sep}`) || rel === '..' || resolve(reportPath) === evidenceRoot) {
  throw new Error('Supply a report.json path inside qa/evidence/');
}
const rawReport = await readFile(reportPath, 'utf8');
const report = JSON.parse(rawReport);
const requests = report.requests ?? [];
const scenarios = report.scenarios ?? [];
const successful = r => r.response.httpStatus >= 200 && r.response.httpStatus < 300
  && r.response.body?.ok !== false && !r.response.transportError;
const unwrap = body => body?.data ?? body;
const tally = list => Object.fromEntries(['PASS', 'FAIL', 'BLOCKED', 'NOT_RUN'].map(status =>
  [status, list.filter(item => item.status === status).length]));
const expected = JSON.parse(await readFile(resolve(qaDir, 'heldout/ko.expected.json'), 'utf8'));
const expectedEn = JSON.parse(await readFile(resolve(qaDir, 'heldout/en.expected.json'), 'utf8'));
const queryChecks = [expected, expectedEn].flatMap(scenario => scenario.questions.map(question => {
  const check = scenarios.find(s => s.id === scenario.id)?.checks.find(c => c.questionId === question.id);
  const request = requests.find(r => r.scenarioId === scenario.id && r.questionId === question.id);
  const ingestRequest = requests.find(r => r.scenarioId === scenario.id && r.path === '/api/ingest');
  const answer = unwrap(request?.response.body);
  const rescored = request && successful(request) && ingestRequest
    ? evaluateAnswer(answer, question, unwrap(ingestRequest.response.body)?.utterances ?? [], ingestRequest.payload.text)
    : check;
  return { scenarioId: scenario.id, questionId: question.id, rule: question.rule,
    status: rescored?.status ?? 'NOT_RUN', detail: rescored?.detail ?? 'Question was not evaluated',
    originalStatus: check?.status ?? 'NOT_RUN', originalDetail: check?.detail ?? null,
    mode: answer?.mode ?? null, route: answer?.route ?? null };
}));
const calls = requests.map((request, index) => {
  const data = unwrap(request.response.body);
  const telemetry = request.response.body?.telemetry ?? data?.telemetry ?? data;
  const route = telemetry?.route ?? data?.route;
  return { call: index + 1, scenarioId: request.scenarioId, questionId: request.questionId ?? null,
    path: request.path, httpStatus: request.response.httpStatus ?? null,
    elapsedMs: request.response.elapsedMs ?? null, mode: data?.mode ?? null,
    duplicate: data?.duplicate ?? false,
    route: { id: (typeof route === 'string' ? route : route?.id) ?? null,
      model: telemetry?.model ?? route?.model ?? null, cached: route?.cached ?? null, ms: route?.ms ?? null },
    rawModelJsonPresent: telemetry?.rawModelJson != null,
    validationPresent: telemetry?.validation != null,
    rejected: telemetry?.rejected ?? data?.rejected ?? null,
    error: request.response.body?.error ?? request.response.transportError ?? null };
});
const modelChecks = scenarios.flatMap(scenario => scenario.checks.filter(c => c.name === 'model evidence')
  .map(check => ({ scenarioId: scenario.id, ...check })));
const ingest = requests.filter(r => r.path === '/api/ingest');
const query = requests.filter(r => r.path === '/api/query');
const modelObserved = calls.filter(c => c.mode === 'model' && c.route.id === 'cursor-cli'
  && typeof c.route.model === 'string' && !c.duplicate);
const summary = {
  assignment: 'T21a', sourceReport: reportPath, sourceStartedAt: report.startedAt,
  sourceReportSha256: createHash('sha256').update(rawReport).digest('hex'),
  evaluatorSha256: createHash('sha256').update(await readFile(resolve(qaDir, 'run-heldout.mjs'))).digest('hex'),
  scoredAt: new Date().toISOString(), originalOverall: report.status,
  overall: [...queryChecks, ...modelChecks].some(c => c.status === 'FAIL') ? 'FAIL'
    : [...queryChecks, ...modelChecks].some(c => c.status === 'BLOCKED' || c.status === 'NOT_RUN') ? 'BLOCKED' : 'PASS',
  rescoreReason: 'Corrected QA representation assumptions only: exact instants can be Slot.value.startIso; AM/PM ambiguity can retain a date/hour object with null time/startIso/daypart. Original reports and expected answer keys unchanged. No network calls during rescore.',
  scores: {
    ingestHttp: { passed: ingest.filter(successful).length, expected: 2, attempted: ingest.length },
    queryHttp: { passed: query.filter(successful).length, expected: 6, attempted: query.length },
    queryAcceptance: { passed: queryChecks.filter(c => c.status === 'PASS').length, expected: 6, ...tally(queryChecks) },
    liveModelQueryAcceptance: { passed: queryChecks.filter(c => c.status === 'PASS' && c.mode === 'model'
      && c.route?.id === 'cursor-cli').length, expected: 6,
      fallbackPasses: queryChecks.filter(c => c.status === 'PASS' && c.mode === 'fallback').length },
    requiredModelEvidence: { passed: modelChecks.filter(c => c.status === 'PASS').length, expected: 2, ...tally(modelChecks) },
    reportedLiveCursorCalls: modelObserved.length,
    reportedUncachedCursorCalls: modelObserved.filter(c => c.route.cached === false).length,
  },
  queryChecks, modelChecks, calls,
  limitations: [...(report.limitations ?? []),
    'A reported model route is an observation, not complete raw-model evidence or independent provider attestation.',
    'Null cached/ms/route fields mean absent from the response, not false/zero or an inferred route.',
    'Query failures retain the original status; no retries or server state changes are performed by this scorer.',
  ],
};
const output = resolve(dirname(reportPath), 'scored-report-v2.json');
await writeFile(output, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ scoredReport: output, ...summary }, null, 2));
