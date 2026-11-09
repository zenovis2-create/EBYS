// English API acceptance only. Never starts/restarts servers or calls action/delete endpoints.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateAnswer, evaluateModelEvidence, probeServer } from './run-heldout.mjs';

const qa = dirname(fileURLToPath(import.meta.url));
const base = 'http://127.0.0.1:8787';
const text = (await readFile(join(qa, 'english-first/conversation.txt'), 'utf8')).trim();
const expected = JSON.parse(await readFile(join(qa, 'english-first/expected.json'), 'utf8'));
if (expected.lang !== 'en' || expected.provenance !== 'synthetic' || expected.questions.length !== 3
    || !text.split(/\r?\n/).every(line => /^[^:]+: .+$/u.test(line))) throw new Error('Invalid synthetic English fixture');
if (process.argv.includes('--validate')) {
  console.log(JSON.stringify({ status: 'PASS', fixture: 'synthetic English', questions: 3,
    slotChecks: expected.questions.reduce((n, q) => n + q.checks.length, 0), networkCalls: 0 }));
} else {
  const stamp = new Date().toISOString();
  const folder = join(qa, 'evidence', `english-first-${stamp.replace(/[:.]/g, '-')}-${process.pid}`);
  await mkdir(folder, { recursive: true });
  const hash = value => createHash('sha256').update(value).digest('hex');
  const report = {
    priority: 'ENGLISH-FIRST-OWNER-UPDATE.md', accepted: true, startedAt: stamp,
    provenance: 'synthetic', fixtureSha256: hash(text), runnerSha256: hash(await readFile(fileURLToPath(import.meta.url))),
    expected, requests: [], questionChecks: [], status: 'RUNNING',
    browserDefault: { status: 'BLOCKED', reason: 'Browser access host unavailable; native Chrome access rejected: Computer Use was not approved to use Google Chrome. No alternate browser-control route attempted.' },
    limitations: [
      'HTTP asset checks are source observations, not proof of fresh-browser/storage behavior.',
      'No audio recorded or microphone permission requested. en-US implementation does not prove working voice.',
      'API checks cannot certify natural copy, focus, targets, reduced motion, visible timezone, confirmation UI, or stale-confirm cancellation.',
      'No propose/preview/confirm/cancel/delete or server-control calls; no external calendar, notifications or emergency calls.',
      'Raw HTTP response JSON is preserved. Missing raw model JSON/validation is explicitly blocked, not inferred.',
    ],
  };
  const save = () => writeFile(join(folder, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  const unwrap = body => body?.data ?? body;
  async function call(method, path, payload) {
    const allowed = method === 'GET' ? ['/api/runtime', '/ui/index.html', '/ui/i18n.js', '/ui/lib/speech.js'] : ['/api/ingest', '/api/query'];
    if (!allowed.includes(path)) throw new Error('Outside English QA endpoint scope');
    const start = performance.now();
    const result = { method, path, ...(payload ? { payload } : {}) };
    try {
      const response = await fetch(`${base}${path}`, {
        method, redirect: 'error', signal: AbortSignal.timeout(method === 'GET' ? 5000 : 180_000),
        ...(payload ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) } : {}),
      });
      result.httpStatus = response.status;
      result.raw = await response.text();
      try { result.body = JSON.parse(result.raw); } catch { /* Static assets remain raw. */ }
      const data = unwrap(result.body);
      result.route = data?.route ?? null;
      result.mode = data?.mode ?? null;
    } catch (error) { result.transportError = `${error.name}: ${error.message}`; }
    result.elapsedMs = Math.round(performance.now() - start);
    report.requests.push(result);
    await save();
    console.log(JSON.stringify({ path, httpStatus: result.httpStatus, elapsedMs: result.elapsedMs, route: result.route, error: result.transportError }));
    return result;
  }
  const usable = r => r.httpStatus >= 200 && r.httpStatus < 300 && r.body && r.body.ok !== false && !r.transportError;
  report.readiness = await probeServer();
  await save();
  if (!report.readiness.up) {
    report.status = 'BLOCKED';
    report.blocker = `Lead server unavailable: ${report.readiness.error}; zero HTTP requests`;
  } else {
    await call('GET', '/api/runtime');
    const html = await call('GET', '/ui/index.html');
    const i18n = await call('GET', '/ui/i18n.js');
    const speech = await call('GET', '/ui/lib/speech.js');
    report.servedAssetChecks = {
      observedAt: new Date().toISOString(), htmlSha256: hash(html.raw ?? ''), i18nSha256: hash(i18n.raw ?? ''),
      htmlEnglishLanguage: html.httpStatus === 200 ? (/\blang=["']en["']/.test(html.raw) ? 'PASS' : 'FAIL') : 'BLOCKED',
      initialModuleEnglish: i18n.httpStatus === 200 ? (/\blet\s+lang\s*=\s*["']en["']/.test(i18n.raw) ? 'PASS' : 'FAIL') : 'BLOCKED',
      enUsSpeechMapping: speech.httpStatus === 200 && speech.raw.includes('en-US') ? 'SOURCE_PRESENT_ONLY' : 'NOT_OBSERVED',
      browserDefaultVerdict: 'BLOCKED',
    };
    await save();
    const ingestion = await call('POST', '/api/ingest', { title: 'English-first QA synthetic pottery and plant swap', text, lang: 'en', provenance: 'synthetic' });
    if (!usable(ingestion)) {
      report.status = ingestion.transportError ? 'BLOCKED' : 'FAIL';
      report.blocker = 'English ingest unavailable/rejected; no query attempted';
    } else {
      const data = unwrap(ingestion.body);
      report.modelEvidence = evaluateModelEvidence(ingestion.body);
      report.sessionId = data.sessionId;
      if (!data.sessionId || !Array.isArray(data.utterances)) {
        report.status = 'FAIL';
        report.blocker = 'Ingest missing sessionId or utterances';
      } else {
        let transportLost = false;
        for (const question of expected.questions) {
          if (transportLost) {
            report.questionChecks.push({ id: question.id, status: 'BLOCKED', reason: 'Earlier transport failure; no retry' });
            continue;
          }
          const result = await call('POST', '/api/query', { text: question.text, lang: 'en' });
          if (!usable(result)) {
            transportLost = Boolean(result.transportError);
            report.questionChecks.push({ id: question.id, status: transportLost || result.httpStatus >= 500 ? 'BLOCKED' : 'FAIL', reason: 'Query unavailable/rejected; raw failure retained' });
          } else {
            const answer = unwrap(result.body);
            const checks = question.checks.map(check => ({ slot: check.slot ?? 'unknown', ...evaluateAnswer(answer, check, data.utterances, text) }));
            report.questionChecks.push({ id: question.id, status: checks.every(c => c.status === 'PASS') ? 'PASS' : 'FAIL', mode: answer.mode,
              route: answer.route, checks });
          }
          await save();
        }
        report.scores = { questionsPassed: report.questionChecks.filter(q => q.status === 'PASS').length, questionsTotal: 3,
          liveModelQuestionsPassed: report.questionChecks.filter(q => q.status === 'PASS' && q.mode === 'model' && q.route?.id === 'cursor-cli').length,
          slotChecksPassed: report.questionChecks.flatMap(q => q.checks ?? []).filter(c => c.status === 'PASS').length, slotChecksTotal: 5 };
        report.status = report.questionChecks.some(q => q.status === 'FAIL') || Object.values(report.servedAssetChecks).includes('FAIL') ? 'FAIL' : 'BLOCKED';
      }
    }
  }
  report.completedAt = new Date().toISOString();
  await save();
  console.log(JSON.stringify({ status: report.status, scores: report.scores, sourceDefaults: report.servedAssetChecks, modelEvidence: report.modelEvidence, evidenceDir: folder }, null, 2));
  process.exitCode = report.status === 'FAIL' ? 1 : 2;
}
