// HTTP GET and pure served-module checks only. No browser control, model/action calls or storage resets.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { probeServer } from './run-heldout.mjs';

const qa = dirname(fileURLToPath(import.meta.url));
const startedAt = new Date().toISOString();
const output = join(qa, 'evidence', `english-default-recheck-${startedAt.replace(/[:.]/g, '-')}-${process.pid}`);
await mkdir(output, { recursive: true });
const sha = value => createHash('sha256').update(value).digest('hex');
const requests = [], checks = [];
const readiness = await probeServer();
let transportUnavailable = !readiness.up;
const check = (name, ok, detail) => checks.push({ name, status: ok ? 'PASS' : transportUnavailable ? 'BLOCKED' : 'FAIL', detail });
async function get(path, label) {
  const requestedAt = new Date().toISOString();
  if (transportUnavailable) {
    const result = { label, path, method: 'GET', requestedAt, skipped: true, transportError: 'Server unavailable; no further HTTP request attempted' };
    requests.push(result);
    return result;
  }
  try {
    const r = await fetch(`http://127.0.0.1:8787${path}`, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(5000) });
    const raw = await r.text();
    let body;
    try { body = JSON.parse(raw); } catch { /* Keep raw HTML/JS/CSS. */ }
    const result = { label, path, method: 'GET', requestedAt, completedAt: new Date().toISOString(),
      httpStatus: r.status, location: r.headers.get('location'), contentType: r.headers.get('content-type'), raw, body, sha256: sha(raw) };
    requests.push(result);
    return result;
  } catch (error) {
    transportUnavailable = true;
    const result = { label, path, method: 'GET', requestedAt, transportError: `${error.name}: ${error.message}`, cause: error.cause?.message, causeCode: error.cause?.code };
    requests.push(result);
    return result;
  }
}
const runtimeBefore = await get('/api/runtime', 'runtime-before');
const root = await get('/', 'root-no-override');
check('bare root redirects to live without a language override', root.httpStatus === 302 && root.location === '/?api=live', { status: root.httpStatus, location: root.location });
const html = await get('/?api=live', 'root-live-html');
const app = await get('/app.js', 'root-app-module');
const css = await get('/styles.css', 'root-styles');
const i18n = await get('/i18n.js', 'served-i18n');
const prefs = await get('/lib/prefs.js', 'served-preferences');
const korean = await get('/?lang=ko', 'explicit-korean-entry');
const fixture = await get('/?api=fixture', 'explicit-fixture-entry');
const runtimeAfter = await get('/api/runtime', 'runtime-after');
check('root live entry and module assets return successful content', html.httpStatus === 200 && app.httpStatus === 200 && css.httpStatus === 200
  && /html/.test(html.contentType ?? '') && /javascript/.test(app.contentType ?? '') && /css/.test(css.contentType ?? ''), { html: html.httpStatus, app: app.httpStatus, css: css.httpStatus });
check('served HTML English default (11:26 source failure recheck)', html.httpStatus === 200 && /<html\s+[^>]*lang=["']en["']/i.test(html.raw ?? ''), { htmlSha256: html.sha256 });
check('served i18n initializes English (11:26 source failure recheck)', i18n.httpStatus === 200 && /\blet\s+lang\s*=\s*["']en["']/.test(i18n.raw ?? ''), { i18nSha256: i18n.sha256 });
check('explicit optional Korean survives root redirect', korean.httpStatus === 302 && korean.location === '/?lang=ko&api=live', { status: korean.httpStatus, location: korean.location });
check('explicit fixture remains separate and reachable', fixture.httpStatus === 200, { status: fixture.httpStatus });
try {
  if (prefs.httpStatus !== 200 || i18n.httpStatus !== 200) throw new Error('Served modules unavailable');
  const preferences = await import(`data:text/javascript;base64,${Buffer.from(prefs.raw).toString('base64')}`);
  const languages = await import(`data:text/javascript;base64,${Buffer.from(i18n.raw).toString('base64')}`);
  const empty = { getItem: () => null };
  const malformed = { getItem: () => 'not-json' };
  const denied = { getItem: () => { throw new Error('synthetic blocked storage'); } };
  const savedKo = { getItem: () => '{"lang":"ko","scale":1.25}' };
  check('pure served-module initial language is en', languages.getLang() === 'en', { kind: 'Node module check, not browser rendering' });
  check('pure fresh-storage preference is en', preferences.loadPrefs('', empty).lang === 'en', { kind: 'in-memory fresh-storage unit check' });
  check('malformed or unavailable storage keeps English', preferences.loadPrefs('', malformed).lang === 'en' && preferences.loadPrefs('', denied).lang === 'en', { kind: 'synthetic storage unit check' });
  check('saved or explicit Korean is optional', preferences.loadPrefs('', savedKo).lang === 'ko' && preferences.loadPrefs('?lang=ko', empty).lang === 'ko', { kind: 'explicit-choice unit check' });
} catch (error) { checks.push({ name: 'served module preference execution', status: transportUnavailable ? 'BLOCKED' : 'FAIL', detail: error.message }); }
const before = runtimeBefore.body?.data, after = runtimeAfter.body?.data;
check('runtime HTTP/version and code/UI snapshots remain current across this GET-only check', runtimeBefore.httpStatus === 200 && runtimeAfter.httpStatus === 200
  && typeof before?.version === 'string' && before.version === after?.version
  && before.sourceSnapshot?.serverCurrent === true && after.sourceSnapshot?.serverCurrent === true
  && before.sourceSnapshot.serverLoaded.sha256 === after.sourceSnapshot.serverLoaded.sha256
  && before.sourceSnapshot.uiOnDisk.sha256 === after.sourceSnapshot.uiOnDisk.sha256,
{ beforeVersion: before?.version, afterVersion: after?.version, before: before?.sourceSnapshot, after: after?.sourceSnapshot });
const report = {
  producer: 'sj-qa', startedAt, completedAt: new Date().toISOString(), runnerSha256: sha(await readFile(fileURLToPath(import.meta.url))),
  scope: 'Recheck 11:26 HTTP/source default failures and root routing; not a fresh browser profile execution', readiness, requests, checks,
  scores: { passed: checks.filter(c => c.status === 'PASS').length, total: checks.length,
    historicalSourceFailuresNowPassed: checks.filter(c => c.name.includes('11:26') && c.status === 'PASS').length, historicalSourceChecks: 2,
    newModelCalls: 0, newActionCalls: 0, newBrowserControlCalls: 0 },
  status: checks.some(c => c.status === 'FAIL') ? 'FAIL_FOR_HTTP_SOURCE_OR_UNIT_SCOPE' : transportUnavailable ? 'BLOCKED_TRANSPORT' : 'PASS_FOR_HTTP_SOURCE_AND_UNIT_SCOPE',
  freshBrowserDefault: { status: 'NOT_RUN_BY_SJ_QA', owner: 'parent-Aside', reason: 'Existing Chrome-control rejection is not bypassed; parent owns visual E2E. Lead RESOLVED note is producer evidence, not a new QA browser run.' },
  historicalEvidence: { run: 'english-first-2026-11-09T02-26-00-060Z-65628', status: 'Original FAIL observations at 11:26 preserved unchanged' },
  limitations: ['No DOM mounting/module dependency execution, visual natural-copy review, live model accuracy, action/readback, accessibility or physical-device proof.',
    'Empty-storage preference checks execute served code in Node with synthetic storage; they are not a browser or navigator-locale test.'],
};
await writeFile(join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ output, status: report.status, scores: report.scores, checks, freshBrowserDefault: report.freshBrowserDefault }, null, 2));
process.exitCode = checks.some(c => c.status === 'FAIL') ? 1 : transportUnavailable ? 2 : 0;
