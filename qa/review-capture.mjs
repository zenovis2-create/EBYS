// Read existing capture evidence and optionally probe GET-only routes. Never opens a browser or calls a model/action API.
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, resolve, join, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateModelEvidence } from './run-heldout.mjs';

const qaDir = dirname(fileURLToPath(import.meta.url));
const project = resolve(qaDir, '..');
const source = resolve(process.argv[2] ?? '');
const rel = relative(project, source);
if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('Capture folder must be inside this project');
const stamp = new Date().toISOString();
const output = join(qaDir, 'evidence', `capture-review-${stamp.replace(/[:.]/g, '-')}-${process.pid}`);
await mkdir(output, { recursive: true });
const hash = value => createHash('sha256').update(value).digest('hex');
const json = async name => JSON.parse(await readFile(join(source, name), 'utf8'));
const manifest = await json('manifest.json');
const timeline = await json('timeline.json');
const reportedChecks = await json('checks-summary.json');
const telemetry = await json('api-telemetry.json');
if (!Array.isArray(telemetry)) throw new Error('Unexpected capture telemetry format');
const videoPath = resolve(source, manifest.relativeFile);
if (dirname(videoPath) !== source) throw new Error('Video path escapes capture directory');
const files = [];
for (const file of await readdir(source, { withFileTypes: true })) {
  if (file.isFile()) {
    const bytes = await readFile(join(source, file.name));
    files.push({ name: file.name, bytes: bytes.length, sha256: hash(bytes) });
  }
}
const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height,r_frame_rate,duration', '-of', 'json', videoPath], { encoding: 'utf8' });
if (probe.status !== 0) throw new Error(`ffprobe failed: ${probe.stderr}`);
const media = JSON.parse(probe.stdout);
const stream = media.streams.find(s => s.codec_type === 'video');
const decode = spawnSync('ffmpeg', ['-v', 'error', '-i', videoPath, '-f', 'null', '-'], { encoding: 'utf8' });
const frames = [];
for (const [label, seconds] of [['opening', 2.5], ['source', 4.5], ['memory', 38.5], ['evidence', 41.2], ['answer', 80.5], ['clarify', 83.6], ['choice', 87.5], ['confirm', 90.5], ['result', 94.3]]) {
  const name = `${label}-${seconds}s.png`;
  const frame = spawnSync('ffmpeg', ['-v', 'error', '-ss', String(seconds), '-i', videoPath, '-frames:v', '1', join(output, name)], { encoding: 'utf8' });
  frames.push({ label, seconds, file: name, status: frame.status === 0 ? 'EXTRACTED_NOT_YET_VISUALLY_REVIEWED' : 'FAIL', error: frame.status === 0 ? null : frame.stderr });
}
const modelEntries = telemetry.filter(c => ['/api/ingest', '/api/query'].includes(c.path));
const apiReview = modelEntries.map(call => {
  const body = call.body ?? call.response?.body;
  return { path: call.path, producerReportedStatus: call.status, producerReportedMode: call.mode,
    producerReportedRoute: call.route,
    routeSummaryConsistent: call.status === 200 && call.mode === 'model' && call.route?.id === 'cursor-cli'
      && typeof call.route?.model === 'string' && typeof call.route?.cached === 'boolean' && Number.isFinite(call.route?.ms),
    rawModelJsonPresentFlag: call.rawModelJsonPresent ?? null, validationOkFlag: call.validationOk ?? null,
    originalResponseBodyPresent: body != null,
    independentModelEvidence: body == null ? { status: 'BLOCKED', detail: 'Summary flags are not raw model JSON or validation objects; original API body absent' } : evaluateModelEvidence(body) };
});
const runtimeChecks = [];
if (process.argv.includes('--probe-static')) {
  for (const path of ['/api/runtime', '/', '/app.js', '/styles.css', '/ui/app.js', '/ui/test/ui.test.mjs', '/ui/tools/smoke.browser.mjs', '/server.mjs', '/core/core.mjs']) {
    const expected = path.includes('/test/') || path.includes('/tools/') || ['/server.mjs', '/core/core.mjs'].includes(path) ? 404 : 200;
    const startedAt = new Date().toISOString();
    try {
      const response = await fetch(`http://127.0.0.1:8787${path}`, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(5000) });
      const raw = await response.text();
      runtimeChecks.push({ method: 'GET', path, startedAt, completedAt: new Date().toISOString(), expectedStatus: expected,
        httpStatus: response.status, contentType: response.headers.get('content-type'), raw, status: response.status === expected ? 'PASS' : 'FAIL' });
    } catch (error) { runtimeChecks.push({ method: 'GET', path, status: 'BLOCKED', error: `${error.name}: ${error.message}` }); break; }
  }
}
const snapshot = manifest.sourceSnapshot;
const [extractStart, extractEnd] = ['model-extraction-start', 'model-extraction-done'].map(step => timeline.timeline.find(t => t.step === step)?.atSeconds);
const [queryStart, queryEnd] = ['model-query-start', 'model-query-done'].map(step => timeline.timeline.find(t => t.step === step)?.atSeconds);
const report = {
  reviewedAt: stamp, producer: 'sj-qa independent review of lead-produced capture', source, output,
  sourceFiles: files, manifest, media, frames,
  integrity: {
    videoHashMatches: files.find(f => f.name === manifest.relativeFile)?.sha256 === manifest.sha256,
    dimensionsMatch: stream?.width === manifest.width && stream?.height === manifest.height,
    fpsMatches: stream?.r_frame_rate === `${manifest.fps}/1`,
    durationMatches: Math.abs(Number(media.format.duration) - manifest.durationSeconds) <= 0.02,
    audioPresenceMatches: media.streams.some(s => s.codec_type === 'audio') === manifest.audioPresent,
    fullDecode: decode.status === 0, decodeErrors: decode.stderr,
    captureSnapshotInternallyConsistent: snapshot?.serverCurrent === true && snapshot?.serverLoaded?.sha256 === snapshot?.serverOnDisk?.sha256,
  },
  apiReview,
  scores: { routeSummariesConsistent: apiReview.filter(r => r.routeSummaryConsistent).length, modelCallsReported: apiReview.length,
    completeModelEvidencePassed: apiReview.filter(r => r.independentModelEvidence.status === 'PASS').length,
    originalResponseBodiesPresent: apiReview.filter(r => r.originalResponseBodyPresent).length,
    independentHeldoutQuestions: 0, newQaModelCalls: 0, newQaActionCalls: 0,
    getOnlyRouteChecksPassed: runtimeChecks.filter(c => c.status === 'PASS').length, getOnlyRouteChecksTotal: runtimeChecks.length },
  timelineLatency: { extractionWallMs: Math.round((extractEnd - extractStart) * 1000), queryWallMs: Math.round((queryEnd - queryStart) * 1000),
    modelMsReported: apiReview.map(c => ({ path: c.path, ms: c.producerReportedRoute?.ms })) },
  producerChecks: reportedChecks,
  staticGetChecks: runtimeChecks,
  disposition: 'PENDING_HUMAN_FRAME_REVIEW; model raw-evidence claim BLOCKED',
  limitations: [
    'Lead-produced screenshots encoded with real inter-frame timings; this is not an independently recorded continuous screen capture or physical-phone test.',
    'Producer booleans/checks are assertions, not independently preserved response bodies or source spans.',
    'Single capture-start sourceSnapshot lacks runtime.version and an after-run bracket; current GET runtime is separate evidence, not retroactive capture provenance.',
    'One known lead scenario and one question are not QA held-out acceptance; unknown/relevance, stale cancellation, duplicate confirmation and errors were not exercised.',
    '390 CSS viewport is producer-reported; video dimensions alone do not prove CSS overflow/focus/targets/zoom/reduced-motion behavior.',
    'Calendar execution is simulated; no real-local file readback, phone calendar, OS notification, voice, watch or safety capability is certified.',
    '96.467-second raw capture exceeds the 90-second final submission target; Mac must separately verify its edited final export.',
  ],
};
await writeFile(join(output, 'review.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ output, integrity: report.integrity, scores: report.scores, apiReview, frames }, null, 2));
