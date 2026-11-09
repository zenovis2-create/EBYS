// Lead-authorized serial reruns with runtime brackets. No action/delete/server-control/browser calls.
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const qa = dirname(fileURLToPath(import.meta.url)), project = resolve(qa, '..');
const stamp = new Date().toISOString();
const bundle = join(qa, 'evidence', `live-acceptance-${stamp.replace(/[:.]/g, '-')}-${process.pid}`);
await mkdir(bundle, { recursive: true });
const sha = value => createHash('sha256').update(value).digest('hex');
const report = { producer: 'sj-qa', startedAt: stamp, purpose: 'Sequential held-out then English-first on lead-ready server',
  runnerSha256: sha(await readFile(fileURLToPath(import.meta.url))), runs: [], status: 'RUNNING',
  limitations: ['No fresh-browser/device/UI E2E, local calendar, notification or action acceptance.',
    'Runtime version/source hashes are recorded separately from semantic answer scores.',
    'UI changes are not silently combined into one stable visual-build claim.'], modelLane: 'serial; one invocation of each authorized runner; no QA retries' };
const save = () => writeFile(join(bundle, 'sequence.json'), `${JSON.stringify(report, null, 2)}\n`);
async function runtime() {
  const requestedAt = new Date().toISOString();
  try {
    const response = await fetch('http://127.0.0.1:8787/api/runtime', { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(5000) });
    const raw = await response.text();
    let body;
    try { body = JSON.parse(raw); } catch { /* Keep raw failure. */ }
    return { requestedAt, capturedAt: new Date().toISOString(), httpStatus: response.status, raw, body };
  } catch (error) { return { requestedAt, capturedAt: new Date().toISOString(), transportError: `${error.name}: ${error.message}`, cause: error.cause?.message }; }
}
const current = r => r.httpStatus === 200 && r.body?.ok === true && r.body.data?.sourceSnapshot?.serverCurrent === true;
const sameServer = (a, b) => a.body?.data?.sourceSnapshot?.serverLoaded?.sha256 === b.body?.data?.sourceSnapshot?.serverLoaded?.sha256
  && a.body?.data?.sourceSnapshot?.serverLoaded?.startedAt === b.body?.data?.sourceSnapshot?.serverLoaded?.startedAt;
const sameUi = (a, b) => a.body?.data?.sourceSnapshot?.uiOnDisk?.sha256 === b.body?.data?.sourceSnapshot?.uiOnDisk?.sha256;
async function run(script) {
  const dirsBefore = new Set((await readdir(join(qa, 'evidence'), { withFileTypes: true })).filter(d => d.isDirectory()).map(d => d.name));
  const child = spawn(process.execPath, [join(qa, script)], { cwd: project, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', data => { stdout += data; process.stdout.write(data); });
  child.stderr.on('data', data => { stderr += data; process.stderr.write(data); });
  const result = await new Promise(resolveChild => {
    child.once('error', error => resolveChild({ exitCode: null, spawnError: error.message }));
    child.once('close', (exitCode, signal) => resolveChild({ exitCode, signal }));
  });
  const created = (await readdir(join(qa, 'evidence'), { withFileTypes: true })).filter(d => d.isDirectory() && !dirsBefore.has(d.name)
    && (script === 'run-heldout.mjs' ? /^\d{4}-/.test(d.name) : d.name.startsWith('english-first-')));
  return { ...result, stdout, stderr, evidenceDir: created.length === 1 ? join(qa, 'evidence', created[0].name) : null };
}
await save();
console.log(JSON.stringify({ sequenceEvidenceDir: bundle, status: 'STARTING' }));
let serverAnchor;
for (const script of ['run-heldout.mjs', 'run-english-first.mjs']) {
  const before = await runtime();
  const item = { script, before, status: 'PREFLIGHT' };
  report.runs.push(item);
  await save();
  if (!current(before) || (serverAnchor && !sameServer(serverAnchor, before))) {
    item.status = 'BLOCKED'; item.reason = 'Server unreachable, stale, or restarted since sequence began; no next model runner started';
    report.status = 'BLOCKED'; break;
  }
  serverAnchor ??= before;
  console.log(JSON.stringify({ script, status: 'RUNNING', sourceSnapshot: before.body.data.sourceSnapshot }));
  Object.assign(item, await run(script));
  item.after = await runtime();
  item.serverStable = current(item.after) && sameServer(before, item.after);
  item.uiStable = sameUi(before, item.after);
  if (item.evidenceDir) {
    await writeFile(join(item.evidenceDir, 'runtime-before.json'), `${JSON.stringify(before, null, 2)}\n`);
    await writeFile(join(item.evidenceDir, 'runtime-after.json'), `${JSON.stringify(item.after, null, 2)}\n`);
    const raw = await readFile(join(item.evidenceDir, 'report.json'), 'utf8');
    const parsed = JSON.parse(raw);
    item.reportSha256 = sha(raw);
    item.runnerVerdict = parsed.status;
    item.scores = parsed.scores ?? null;
    item.checks = parsed.scenarios?.map(s => ({ id: s.id, checks: s.checks })) ?? parsed.questionChecks;
    item.transportFailure = parsed.requests.some(r => r.response?.transportError || r.transportError);
  }
  item.status = !item.evidenceDir || !item.serverStable || item.transportFailure ? 'BLOCKED'
    : item.exitCode === 0 ? 'PASS' : item.exitCode === 2 ? 'BLOCKED' : 'FAIL';
  await save();
  console.log(JSON.stringify({ script, status: item.status, runnerVerdict: item.runnerVerdict, serverStable: item.serverStable,
    uiStable: item.uiStable, evidenceDir: item.evidenceDir }));
  if (!item.serverStable || item.transportFailure || !item.evidenceDir) { report.status = 'BLOCKED'; break; }
}
if (report.status === 'RUNNING') report.status = report.runs.some(r => r.status === 'FAIL') ? 'FAIL'
  : report.runs.some(r => r.status === 'BLOCKED') ? 'BLOCKED' : 'PASS_FOR_API_SCOPE';
report.completedAt = new Date().toISOString();
report.allUiSnapshotsStable = report.runs.every(r => r.uiStable === true) && report.runs.every(r => sameUi(serverAnchor, r.before));
await save();
console.log(JSON.stringify({ sequenceComplete: true, sequenceEvidenceDir: bundle, status: report.status,
  allUiSnapshotsStable: report.allUiSnapshotsStable, runs: report.runs.map(({ script, status, scores, evidenceDir, serverStable, uiStable }) => ({ script, status, scores, evidenceDir, serverStable, uiStable })) }, null, 2));
process.exitCode = report.status === 'PASS_FOR_API_SCOPE' ? 0 : report.status === 'FAIL' ? 1 : 2;
