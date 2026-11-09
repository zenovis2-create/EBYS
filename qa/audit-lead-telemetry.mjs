// Offline independent audit of a lead-owned evidence artifact; no HTTP or model calls.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateModelEvidence } from './run-heldout.mjs';

const qaDir = dirname(fileURLToPath(import.meta.url));
if (!process.argv[2]) throw new Error('Usage: node qa/audit-lead-telemetry.mjs evidence/<lead-artifact>.json');
const sourcePath = resolve(process.argv[2]);
const raw = await readFile(sourcePath, 'utf8');
const source = JSON.parse(raw);
if (!Array.isArray(source.calls)) throw new Error('Expected lead evidence calls array');
const digest = value => createHash('sha256').update(value).digest('hex');
const hashValid = value => typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value);
const checks = source.calls.map((call, index) => {
  const data = call.body?.data ?? call.body;
  const t = data?.telemetry;
  const route = t?.route;
  const last = t?.modelCalls?.at(-1);
  const metadata = evaluateModelEvidence(call.body);
  const required = {
    httpSuccess: call.httpStatus === 200 && call.body?.ok === true,
    modelMode: t?.mode === 'model' && data?.mode === 'model',
    routeBinding: route?.id === data?.route?.id && route?.model === data?.route?.model,
    cachedBinding: typeof route?.cached === 'boolean' && route.cached === data?.route?.cached,
    latencyBinding: Number.isFinite(route?.ms) && route.ms >= 0 && route.ms === data?.route?.ms,
    wallLatency: Number.isFinite(call.wallMs) && call.wallMs >= (route?.ms ?? Infinity),
    rawModelObject: t?.rawModelJson != null && typeof t.rawModelJson === 'object' && !Array.isArray(t.rawModelJson),
    validationRecorded: t?.validation?.ok === true && Number.isInteger(t?.validation?.rejected)
      && t.validation.rejected >= 0 && t.validation.rejected === t?.rejected,
    modelCallBinding: Array.isArray(t?.modelCalls) && t.modelCalls.length > 0 && last?.ok === true
      && last.route === route?.id && last.model === route?.model && last.cached === route?.cached && last.ms === route?.ms,
  };
  return { call: index + 1, path: call.path, question: call.path === '/api/query' ? call.request?.text : null,
    metadataVerdict: metadata, required,
    status: metadata.status === 'PASS' && Object.values(required).every(Boolean) ? 'PASS' : 'FAIL',
    route: route ?? null, wallMs: call.wallMs ?? null, modelCallCount: t?.modelCalls?.length ?? 0,
    rawModelSha256: t?.rawModelJson == null ? null : digest(JSON.stringify(t.rawModelJson)),
    validation: t?.validation ?? null, rejected: t?.rejected ?? null };
});
const snapshot = source.runtime?.sourceSnapshot;
const snapshotChecks = {
  loadedHash: hashValid(snapshot?.serverLoaded?.sha256),
  diskHash: hashValid(snapshot?.serverOnDisk?.sha256),
  uiHash: hashValid(snapshot?.uiOnDisk?.sha256),
  reportedCurrentConsistent: snapshot?.serverCurrent === true
    && snapshot?.serverLoaded?.sha256 === snapshot?.serverOnDisk?.sha256,
};
const busCall = source.calls.find(call => call.path === '/api/query' && /bus route/i.test(call.request?.text ?? ''));
const busAnswer = busCall?.body?.data ?? busCall?.body;
const prior = JSON.parse(await readFile(join(qaDir, 'evidence/2026-11-09T02-43-28-047Z-165224/scored-report-v2.json'), 'utf8'));
const timestamp = new Date().toISOString();
const folder = join(qaDir, 'evidence', `telemetry-audit-${timestamp.replace(/[:.]/g, '-')}-${process.pid}`);
const report = {
  audit: 'Independent QA audit of lead-produced telemetry evidence', auditedAt: timestamp,
  sourcePath, sourceSha256: digest(raw), sourceCapturedAt: source.capturedAt, sourceNote: source.note,
  auditorSha256: digest(await readFile(fileURLToPath(import.meta.url))),
  producer: 'senior-planner (lead); not sj-qa held-out execution', independentAudit: true,
  scores: { telemetryPassed: checks.filter(c => c.status === 'PASS').length, telemetryTotal: checks.length,
    reportedUncachedCalls: checks.filter(c => c.route?.cached === false).length,
    snapshotChecksPassed: Object.values(snapshotChecks).filter(Boolean).length, snapshotChecksTotal: 4,
    newQaModelCalls: 0, newQaHttpCalls: 0 },
  telemetryStatus: checks.length === 5 && checks.every(c => c.status === 'PASS') ? 'PASS' : 'FAIL',
  checks, sourceSnapshot: snapshot ?? null, snapshotChecks,
  busUnknown: { question: busCall?.request?.text ?? null, found: busAnswer?.found ?? null,
    sentence: busAnswer?.sentence ?? null,
    status: busAnswer?.found === true ? 'FAIL' : 'NOT_VERIFIED',
    detail: 'Lead synthetic transcript contains no bus route. Stored response reports found=true and gives book-club/place context. This is not a QA-held-out rerun or independent model execution.' },
  historicalQaVerdict: { report: '2026-11-09T02-43-28-047Z-165224/scored-report-v2.json',
    queriesPassed: prior.scores.queryAcceptance.passed, queriesTotal: 6,
    completeModelEvidencePassed: prior.scores.requiredModelEvidence.passed,
    completeModelEvidenceTotal: 2, unchanged: true },
  limitations: [
    'Telemetry completeness/consistency audit only; not an answer-quality pass or release approval.',
    'Source artifact is lead-produced and explicitly not QA held-out. Five audited calls cannot retroactively fill telemetry missing from historical QA calls.',
    'validation.ok is lead instrumentation derived from result.mode in the inspected flow implementation; this audit does not independently revalidate every raw model item.',
    'The archived sourceSnapshot is a point-in-time server report, not a before/after bracket for each call or independent loaded-module attestation.',
    'Current server/on-disk state was not queried during this offline audit. Owner patches may have landed since capture.',
    'Wait for sj-memory completion and lead reload/ready signal before full held-out rerun. No server control, deletion, actions, model calls or HTTP requests performed.',
  ],
};
await mkdir(folder, { recursive: true });
await writeFile(join(folder, 'source-artifact.json'), raw);
await writeFile(join(folder, 'audit.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ evidenceDir: folder, ...report }, null, 2));
process.exitCode = report.telemetryStatus === 'PASS' && Object.values(snapshotChecks).every(Boolean) ? 0 : 1;
