// Real-app capture for the Mac media pipeline (MEDIA-HANDOFF-CONTRACT.md). Owner: senior-planner.
// Headless browser with a fresh profile: only the page's own pixels are recorded (no desktop, no other windows).
// Requires the EBYS server on 127.0.0.1:8787 and ffmpeg on PATH. Usage: node media-outbox/tools/capture-live-en.mjs
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUTBOX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.EBYS_URL ?? 'http://127.0.0.1:8787';
const MODEL_WAIT_MS = 240_000;
const TEXT = [
  'Priya: Grandpa, Tom from the library called. The book club moved from Wednesday to Thursday at 2.',
  'Grandpa: Thursday at 2, got it. Is it still in the community room?',
  "Priya: No, this time it's at the Oak Street cafe.",
  'Grandpa: And Martha is bringing the cake, right?',
  "Priya: Yes, Martha said she'd bring a lemon cake.",
].join('\n');
const QUESTION = 'When and where is the book club now?';

const chromePath = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(existsSync);
if (!chromePath) throw new Error('no Chrome/Edge found');

const captureId = `ebys-live-en-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const staging = path.join(OUTBOX, 'staging', captureId);
const framesDir = path.join(staging, 'frames');
await mkdir(framesDir, { recursive: true });

const runtime = (await (await fetch(`${BASE}/api/runtime`)).json()).data;
const TRIAL = process.env.EBYS_CAPTURE_TRIAL === '1';
if (!runtime?.sourceSnapshot?.serverCurrent && !TRIAL) throw new Error('server is running stale code (sourceSnapshot.serverCurrent=false); restart it before capturing');

const profile = await mkdtemp(path.join(tmpdir(), 'ebys-capture-'));
const port = 9800 + Math.floor(Math.random() * 150);
const chrome = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run',
  '--no-default-browser-check', '--disable-extensions', '--disable-sync', '--disable-background-networking', '--lang=en-US', 'about:blank'], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function cdpTarget() {
  for (let i = 0; i < 80; i += 1) {
    try { const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); const pg = l.find((x) => x.type === 'page'); if (pg) return pg.webSocketDebuggerUrl; } catch { /* retry */ }
    await sleep(250);
  }
  throw new Error('devtools not reachable');
}
const ws = new WebSocket(await cdpTarget());
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let nextId = 1;
const pending = new Map();
const frames = [];
const apiCalls = new Map();
const sentPaths = [];
const problems = [];
const send = (method, params = {}) => new Promise((resolve) => { const id = nextId++; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
ws.addEventListener('message', async (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); return; }
  if (d.method === 'Network.requestWillBeSent') sentPaths.push(new URL(d.params.request.url).pathname);
  if (d.method === 'Network.responseReceived' && /\/api\/(ingest|query|propose|preview|confirm)/.test(d.params.response.url)) {
    apiCalls.set(d.params.requestId, { url: new URL(d.params.response.url).pathname, status: d.params.response.status });
  }
  if (d.method === 'Network.loadingFinished' && apiCalls.has(d.params.requestId)) {
    const r = await send('Network.getResponseBody', { requestId: d.params.requestId });
    try { apiCalls.get(d.params.requestId).body = JSON.parse(r.result.body); } catch { /* not json */ }
  }
  if (d.method === 'Runtime.exceptionThrown') problems.push(d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text);
});
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(`eval failed: ${expression.slice(0, 120)}`);
  return r.result?.result?.value;
};
const waitFor = async (expr, label, ms = 10_000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await ev(expr)) return; await sleep(150); }
  throw new Error(`timeout waiting for ${label}`);
};
const clickText = (txt, scope = 'main') => ev(`(() => { const b=[...document.querySelectorAll('${scope} button')].find(x=>x.textContent.includes(${JSON.stringify(txt)}) && !x.disabled); if(!b) return false; b.scrollIntoView({block:'center'}); b.click(); return true; })()`);
const clickExact = (txt) => ev(`(() => { const b=[...document.querySelectorAll('main button')].find(x=>x.textContent.trim()===${JSON.stringify(txt)} && !x.disabled); if(!b) return false; b.scrollIntoView({block:'center'}); b.click(); return true; })()`);
const reveal = (sel) => ev(`document.querySelector(${JSON.stringify(sel)})?.scrollIntoView({behavior:'smooth', block:'start'})`);

const t0 = Date.now();
const timeline = [];
const checks = [];
const mark = (step, extra = {}) => { timeline.push({ atSeconds: +((Date.now() - t0) / 1000).toFixed(2), step, ...extra }); console.log(`[${timeline.at(-1).atSeconds}s] ${step}`); };
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`); };

let failed = null;
let recording = Promise.resolve();
let stopRecording = false;
try {
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url: `${BASE}/?api=live` });
  await waitFor(`!!document.querySelector('#screen-title')`, 'app');
  // Screencast frames ignore deviceScaleFactor, so grab full-resolution screenshots in a loop instead.
  recording = (async () => {
    while (!stopRecording) {
      const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 88 });
      if (r.result?.data) {
        const file = path.join(framesDir, `f${String(frames.length).padStart(6, '0')}.jpg`);
        frames.push({ file, ts: Date.now() / 1000 });
        await writeFile(file, Buffer.from(r.result.data, 'base64'));
      }
      await sleep(60);
    }
  })();
  await sleep(1500);
  mark('open-app-fresh-profile');
  check('fresh profile defaults to English (no ?lang)', await ev(`document.documentElement.lang === 'en'`));
  check('live API selected, not fixture', await ev(`!/FIXTURE/.test(document.body.textContent)`));
  // Labels come from the app's own dictionary (same module instance), so copy changes don't break the capture.
  const L = await ev(`import('/i18n.js').then(m => Object.fromEntries(['a1.analyze','a2.evidence','a3.makeProposal','a4.clarifyTitle','a4.pm','a4.saveChanges','a4.confirmTitle','a4.yes','nav.ask'].map(k => [k, m.t(k).split(' · ')[0]])))`);

  await ev(`(() => { const t=document.querySelector('#conv-text'); t.value=${JSON.stringify(TEXT)}; t.dispatchEvent(new Event('input', {bubbles:true})); t.scrollIntoView({block:'center'}); })()`);
  await sleep(2500);
  mark('source-conversation-entered', { note: 'new synthetic English conversation, labelled synthetic' });
  await ev(`document.querySelector('main input[type=checkbox]').click()`);
  await sleep(800);
  if (!(await clickText(L['a1.analyze']))) throw new Error(`"${L['a1.analyze']}" button not found or disabled`);
  for (let i = 0; i < 50 && !sentPaths.includes('/api/ingest'); i += 1) await sleep(100);
  if (!sentPaths.includes('/api/ingest')) throw new Error('ingest request was not sent (consent or button state?)');
  mark('model-extraction-start', { modelWait: true });
  await waitFor(`document.querySelectorAll('article.mem').length >= 1`, 'memories from model', MODEL_WAIT_MS);
  mark('model-extraction-done', { modelWait: false });
  await sleep(2500);
  await clickText(L['a2.evidence']);
  await sleep(1200);
  check('evidence drawer shows a verbatim quote', await ev(`!!document.querySelector('.ev-quote')`));
  mark('evidence-drawer');
  await sleep(3500);
  await ev(`document.getElementById('evidence-dialog')?.close()`);

  await ev(`[...document.querySelectorAll('.nav-item')].find(b=>b.textContent.includes(${JSON.stringify(L['nav.ask'])}))?.click()`);
  await waitFor(`!!document.querySelector('#q')`, 'ask screen');
  await ev(`(() => { const q=document.querySelector('#q'); q.value=${JSON.stringify(QUESTION)}; q.dispatchEvent(new Event('input', {bubbles:true})); })()`);
  await sleep(1500);
  mark('ask-question', { question: QUESTION });
  await ev(`document.querySelector('#q').dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true}))`);
  mark('model-query-start', { modelWait: true });
  await waitFor(`!!document.querySelector('.answer')`, 'answer from model', MODEL_WAIT_MS);
  mark('model-query-done', { modelWait: false });
  await reveal('.answer');
  await sleep(4000);
  check('answer keeps AM/PM open (no invented time)', await ev(`/AM or PM/i.test(document.querySelector('.answer').textContent)`));
  mark('answer-with-sources-and-uncertainty');

  if (await clickText(L['a3.makeProposal'])) {
    await sleep(2500);
    mark('proposal-not-saved-yet');
    await clickText(L['a4.clarifyTitle']);
    await waitFor(`!!document.querySelector('#f-hour')`, 'clarify form');
    check('AM/PM not preselected', await ev(`![...document.querySelectorAll('main [aria-pressed=true]')].some(b=>/^(AM|PM)$/.test(b.textContent.trim()))`));
    mark('clarify-am-pm');
    await sleep(2000);
    await ev(`(() => { const s=document.querySelector('#f-hour'); if (s && !s.value) { s.value='2'; s.dispatchEvent(new Event('change')); } const m=document.querySelector('#f-min'); if (m && !m.value) { m.value='0'; m.dispatchEvent(new Event('change')); } })()`);
    await clickExact(L['a4.pm']);
    await sleep(1500);
    mark('user-chose-pm');
    await clickText(L['a4.saveChanges']);
    await waitFor(`document.body.textContent.includes(${JSON.stringify(L['a4.confirmTitle'])})`, 'confirm card');
    await sleep(3500);
    mark('confirmation-card');
    await clickText(L['a4.yes']);
    await waitFor(`!!document.querySelector('.statecard.st-simulated_completed, .statecard.st-completed_external, .statecard.st-handed_off')`, 'action result', 30_000);
    await sleep(3500);
    check('result is labelled, never an unverified "saved"', await ev(`(() => { const s=document.querySelector('.statecard'); return !!s && (s.classList.contains('st-completed_external') || /simulat/i.test(s.textContent)); })()`));
    mark('labelled-action-result');
  } else check('proposal button present', false, `no "${L['a3.makeProposal']}" on the answer`);
  await sleep(1500);
  mark('end');
} catch (e) {
  failed = String(e?.message ?? e);
  check('capture flow completed', false, failed);
  try {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    await writeFile(path.join(staging, 'failure.png'), Buffer.from(shot.result.data, 'base64'));
    await writeFile(path.join(staging, 'failure-page.txt'), String(await ev(`document.querySelector('main')?.innerText ?? document.body.innerText`)));
  } catch { /* best effort */ }
} finally {
  stopRecording = true;
  await recording;
  try { ws.close(); } catch { /* ignore */ }
  chrome.kill();
  await sleep(500);
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
check('no page exceptions', problems.length === 0, problems.join(' | '));

// Frames -> constant 30 fps MP4 using real inter-frame timings.
if (frames.length < 2) throw new Error('no frames captured');
const list = frames.map((f, i) => `file '${f.file.replaceAll('\\', '/')}'\nduration ${Math.max(0.001, ((frames[i + 1]?.ts ?? f.ts + 2) - f.ts)).toFixed(3)}`).join('\n') + `\nfile '${frames.at(-1).file.replaceAll('\\', '/')}'\n`;
await writeFile(path.join(staging, 'frames.txt'), list);
const video = path.join(staging, `${captureId}.mp4`);
const ff = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', path.join(staging, 'frames.txt'),
  '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-fps_mode', 'cfr', '-r', '30', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-crf', '20', video], { encoding: 'utf8' });
if (ff.status !== 0) throw new Error(`ffmpeg failed: ${ff.stderr}`);
const probe = JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate:format=duration', '-of', 'json', video], { encoding: 'utf8' }).stdout);
await rm(framesDir, { recursive: true, force: true });
await rm(path.join(staging, 'frames.txt'), { force: true });

const calls = [...apiCalls.values()].map((c) => {
  const d = c.body?.data ?? {};
  const t = d.telemetry;
  return { path: c.url, status: c.status, mode: d.mode ?? t?.mode, route: t?.route ?? d.route ?? null, rawModelJsonPresent: t ? t.rawModelJson != null : undefined, validationOk: t?.validation?.ok, displayState: d.displayState };
});
await writeFile(path.join(staging, 'api-telemetry.json'), JSON.stringify(calls, null, 2));
await writeFile(path.join(staging, 'timeline.json'), JSON.stringify({ captureId, text: TEXT, question: QUESTION, timeline, checks, failed }, null, 2));

const modelCalls = calls.filter((c) => /ingest|query/.test(c.path));
const allModel = modelCalls.length >= 2 && modelCalls.every((c) => c.mode === 'model' && c.route?.id === 'cursor-cli' && c.rawModelJsonPresent && c.validationOk);
const passed = (n) => checks.find((c) => c.name === n)?.ok;
const sha = createHash('sha256').update(await readFile(video)).digest('hex');
const manifest = {
  schemaVersion: 1,
  project: 'EBYS',
  buildCommit: (() => {
    const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: path.join(OUTBOX, '..'), encoding: 'utf8' });
    if (head.status !== 0) return null;
    const dirty = spawnSync('git', ['status', '--porcelain'], { cwd: path.join(OUTBOX, '..'), encoding: 'utf8' }).stdout.trim() !== '';
    return { sha: head.stdout.trim(), workingTreeDirty: dirty };
  })(),
  sourceSnapshot: runtime.sourceSnapshot,
  appUrl: `${BASE}/?api=live`,
  capturedAt: new Date(t0).toISOString(),
  sourceMachine: 'windows-zenovis (lead senior-planner)',
  captureType: 'headless-browser page screenshots at real timings (page pixels only, fresh profile, 390x844 CSS @2x)',
  relativeFile: `${captureId}.mp4`,
  sha256: sha,
  durationSeconds: Number(Number(probe.format.duration).toFixed(2)),
  width: probe.streams[0].width,
  height: probe.streams[0].height,
  fps: 30,
  audioPresent: false,
  syntheticData: true,
  containsPersonalData: false,
  modelWaitSegments: timeline.filter((x) => x.modelWait !== undefined).map(({ atSeconds, step }) => ({ atSeconds, step })),
  featureClaims: [
    { name: 'English default on a fresh profile', status: passed('fresh profile defaults to English (no ?lang)') ? 'verified' : 'unverified', evidence: 'timeline.json checks' },
    { name: 'Real model extraction + recall on new synthetic text', status: allModel ? 'verified' : 'unverified', evidence: 'api-telemetry.json (mode, route, rawModelJson, validation)' },
    { name: 'Source evidence (verbatim quote)', status: passed('evidence drawer shows a verbatim quote') ? 'verified' : 'unverified', evidence: 'timeline.json' },
    { name: 'AM/PM clarification, explicit user choice', status: passed('AM/PM not preselected') && passed('answer keeps AM/PM open (no invented time)') ? 'verified' : 'unverified', evidence: 'timeline.json' },
    { name: 'Confirmation before action', status: timeline.some((x) => x.step === 'confirmation-card') ? 'verified' : 'unverified', evidence: 'timeline.json' },
    { name: 'Calendar action', status: calls.some((c) => c.displayState === 'completed_external') ? 'verified' : 'simulated', evidence: 'api-telemetry.json displayState' },
    { name: 'Watch, 24h audio, glasses, safety/119', status: 'roadmap', evidence: 'not implemented' },
  ],
  rightsNotes: 'Original EBYS app UI captured by the team; synthetic conversation written for this capture; no third-party media, no real people or recordings.',
};
if (TRIAL) checks.push({ name: 'not a trial run (trial footage is never deliverable)', ok: false, detail: `serverCurrent=${runtime.sourceSnapshot?.serverCurrent}` });
const ok = !failed && checks.every((c) => c.ok);
await writeFile(path.join(staging, 'checks-summary.json'), JSON.stringify({ ok, checks }, null, 2));
const finalDir = path.join(OUTBOX, ok ? captureId : `REJECTED-${captureId}`);
await rename(staging, finalDir);
await writeFile(path.join(finalDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`${ok ? 'READY' : 'REJECTED'} ${finalDir}`);
console.log(JSON.stringify({ durationSeconds: manifest.durationSeconds, width: manifest.width, height: manifest.height, sha256: sha, claims: manifest.featureClaims.map((c) => `${c.name}: ${c.status}`) }, null, 2));
