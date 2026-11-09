// Optional browser smoke test (zero deps). Starts a throwaway static server for ui/ (+ /contracts/) and a
// headless Chrome/Edge with a FRESH TEMP profile, drives the sample-mode flow over the DevTools protocol,
// writes 390px screenshots to ui/tools/screens/, and asserts honesty/accessibility properties.
// Usage: node ui/tools/smoke.browser.mjs                       (sample mode only: UI wiring, NOT the AI)
//        node ui/tools/smoke.browser.mjs --live=http://127.0.0.1:8787   (adds a real ?api=live English run;
//        ingests one NEW synthetic conversation, then deletes only that session; never "delete all")
import http from 'node:http';
import { readFile, mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const uiRoot = join(here, '..');
const contractsRoot = join(uiRoot, '..', 'contracts');
const outDir = join(here, 'screens');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const liveArg = process.argv.find((a) => a.startsWith('--live='))?.slice(7) ?? null;
const onlyLive = process.argv.includes('--only-live');

const chromePath = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(existsSync);
if (!chromePath) { console.log('SKIP: no Chrome/Edge found'); process.exit(0); }

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  let file = u.pathname === '/' ? '/index.html' : u.pathname;
  const base = file.startsWith('/contracts/') ? contractsRoot : uiRoot;
  if (file.startsWith('/contracts/')) file = file.slice('/contracts'.length);
  const p = join(base, file);
  if (!p.startsWith(base) || (file.includes('/test/') || file.includes('/tools/'))) { res.writeHead(404).end(); return; }
  try { const b = await readFile(p); res.writeHead(200, { 'content-type': MIME[extname(p)] ?? 'application/octet-stream' }).end(b); } catch { res.writeHead(404).end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const profile = await mkdtemp(join(tmpdir(), 'sj-ui-smoke-'));
const port = 9300 + Math.floor(Math.random() * 500);
// --lang=ko-KR: a Korean-locale browser must STILL start in English (no navigator.language use).
const chrome = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--lang=ko-KR',
  '--no-default-browser-check', '--disable-extensions', '--disable-sync', '--disable-background-networking', 'about:blank'], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function cdpTarget() {
  for (let i = 0; i < 60; i += 1) {
    try { const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); const pg = l.find((x) => x.type === 'page'); if (pg) return pg.webSocketDebuggerUrl; } catch { /* retry */ }
    await sleep(250);
  }
  throw new Error('chrome devtools not reachable');
}
const ws = new WebSocket(await cdpTarget());
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let nextId = 1; const pending = new Map(); const problems = [];
ws.addEventListener('message', (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  if (d.method === 'Runtime.exceptionThrown') problems.push(`exception: ${d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text}`);
  if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') problems.push(`console.error: ${d.params.args.map((a) => a.value ?? a.description).join(' ')}`);
  if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error') problems.push(`log: ${d.params.entry.text} ${d.params.entry.url ?? ''}`);
});
const send = (method, params = {}) => new Promise((resolve) => { const id = nextId++; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(`eval failed: ${expression}\n${JSON.stringify(r.result.exceptionDetails.exception?.description)}`);
  return r.result?.result?.value;
};
const waitFor = async (expr, label, ms = 8000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await ev(expr)) return Date.now() - t0; await sleep(100); }
  throw new Error(`timeout waiting for ${label}`);
};
const clickText = (txt) => ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes(${JSON.stringify(txt)}) && !x.disabled); if(!b) return false; b.click(); return true; })()`);
const clickExact = (txt) => ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===${JSON.stringify(txt)} && !x.disabled); if(!b) return false; b.click(); return true; })()`);
const clickNav = (txt) => ev(`(() => { const b=[...document.querySelectorAll('.nav-item')].find(x=>x.textContent.includes(${JSON.stringify(txt)})); if(!b) return false; b.click(); return true; })()`);
const setTime = (hour, minute) => ev(`(() => { const s=document.querySelector('#f-hour'); s.value='${hour}'; s.dispatchEvent(new Event('change')); const m=document.querySelector('#f-min'); m.value='${minute}'; m.dispatchEvent(new Event('change')); })()`);
const body = () => ev('document.body.innerText');
const shot = async (name) => {
  await mkdir(outDir, { recursive: true });
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  await writeFile(join(outDir, `${name}.png`), Buffer.from(r.result.data, 'base64'));
};
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` :: ${detail}` : ''}`); };
// Mobile emulation widens the layout viewport to fit overflowing content, so measure against the fixed 390px device width.
const noOverflow = async (label) => {
  const bad = await ev(`[...document.querySelectorAll('body *')].filter(e => { const r=e.getBoundingClientRect(); return r.width>0 && (r.right > 391 || r.left < -1) && !e.closest('.chips:not(.chips-wrap)') && !e.closest('dialog:not([open])') && !e.classList.contains('skip') && !(e.closest('.hero') && getComputedStyle(e, null).position==='absolute'); })
    .sort((a,b) => (b.getBoundingClientRect().width - a.getBoundingClientRect().width))
    .slice(0,6).map(e => e.tagName+'.'+e.className+' w='+Math.round(e.getBoundingClientRect().width)+' right='+Math.round(e.getBoundingClientRect().right))`);
  check(`no horizontal overflow (${label})`, bad.length === 0, bad.join(' | '));
};
const minTap = async (label) => {
  const small = await ev(`[...document.querySelectorAll('button, select, input[type=text], input[type=date], textarea, summary')]
    .filter(e => { const r=e.getBoundingClientRect(); return r.width>0 && r.height>0 && (r.height < 56 || r.width < 56); })
    .map(e => e.tagName + ':' + (e.textContent||e.id).trim().slice(0,20) + ' ' + Math.round(e.getBoundingClientRect().height) + 'x' + Math.round(e.getBoundingClientRect().width))`);
  check(`controls >= 56px (${label})`, small.length === 0, small.join(' | '));
};
const primaryTall = async (label) => {
  const small = await ev(`[...document.querySelectorAll('.btn-primary')].filter(e => e.getBoundingClientRect().height > 0 && e.getBoundingClientRect().height < 64).map(e => e.textContent.trim().slice(0,24) + ' ' + Math.round(e.getBoundingClientRect().height))`);
  check(`primary buttons >= 64px (${label})`, small.length === 0, small.join(' | '));
};
const navFits = async (label) => {
  const r = await ev(`[...document.querySelectorAll('.nav-label')].map(e => ({ t: e.textContent, clip: e.scrollWidth > e.parentElement.clientWidth + 1 }))`);
  check(`bottom nav labels unclipped (${label})`, r.length === 4 && r.every((x) => !x.clip), JSON.stringify(r));
};

// Ingest -> memories (sample or live)
async function ingestSample(label) {
  await clickText(label);
  await ev(`document.querySelector('#consent').checked || document.querySelector('#consent').click()`);
  await clickText('Read this conversation');
  await waitFor(`document.querySelectorAll('article.mem').length >= 3`, 'memories');
}
async function planFromClinicQuestion() {
  await clickNav('Ask'); await clickText('Who and when is the clinic visit?');
  await waitFor(`!!document.querySelector('.answer')`, 'answer');
  await clickText('Make it a plan?');
  await waitFor(`!!document.querySelector('.statecard')`, 'proposal card');
}

try {
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  const open = async (qs, root = base, path = '/index.html') => {
    await send('Page.navigate', { url: `${root}${path}?${root === base ? 'fast=1' : ''}${qs}` });
    await waitFor(`!!document.querySelector('#screen-title')`, 'page', 15000); await sleep(300);
  };

  if (!onlyLive) {
    // 1 Home, fresh profile, Korean-locale browser => English
    await open('');
    check('fresh profile defaults to English (browser launched with --lang=ko-KR)', await ev(`document.documentElement.lang === 'en' && navigator.language.startsWith('ko')`), await ev('navigator.language'));
    check('privacy strip says microphone off', await ev(`document.querySelector('.privacybar')?.textContent.includes('Microphone off')`));
    check('sample mode clearly labelled (pill + honesty footer)', await ev(`document.querySelector('.modepill')?.textContent.includes('Sample · not real AI') && document.querySelector('.honesty')?.textContent.includes('synthetic')`));
    check('original brand mark + real SVG favicon', await ev(`!!document.querySelector('.appbar svg.brandmark') && document.querySelector('link[rel=icon]').getAttribute('href') === 'assets/ebys-mark.svg'`));
    check('favicon asset served', await ev(`fetch('assets/ebys-mark.svg').then(r => r.ok && r.headers.get('content-type').includes('svg'))`));
    await shot('01-home-en'); await noOverflow('home 100%'); await minTap('home'); await primaryTall('home'); await navFits('home 100%');
    await clickText('Sample 1');
    check('sample text filled (English clinic)', await ev(`document.querySelector('#conv-text').value.includes('Harbor Clinic')`));
    await clickText('Read this conversation');
    check('read blocked without consent; consent focused', await ev(`!!document.querySelector('.errorbox') && document.activeElement?.id === 'consent'`));
    await ev(`document.querySelector('#consent').click()`);
    await clickText('Read this conversation');
    await waitFor(`document.querySelectorAll('article.mem').length >= 3`, 'memories');
    check('3 memories listed', await ev(`document.querySelectorAll('article.mem').length === 3`));
    check('object when.value shown as English text (GAP3)', await ev(`document.querySelector('.facts')?.textContent.includes('Thu, Nov 12, around 3') && !document.body.innerText.includes('[object Object]')`));
    check('superseded memory is struck/labelled', await ev(`!!document.querySelector('.mem-inactive .st-superseded')`));
    check('sample result labelled not-a-model', await ev(`document.body.innerText.includes('cannot read new text') || document.body.innerText.includes('not a real model')`));
    await shot('02-memories-en'); await noOverflow('memories'); await minTap('memories');

    // 2 Source drawer
    await ev(`[...document.querySelectorAll('button')].filter(b=>b.textContent.includes('See the source'))[0].click()`);
    await waitFor(`document.getElementById('evidence-dialog').open`, 'dialog');
    check('source shows verbatim quote + verified mark + highlight', await ev(`!!document.querySelector('.ev-quote') && !!document.querySelector('.ev-ok') && !!document.querySelector('.ev-line mark')`));
    await shot('03-source-en');
    await ev(`document.getElementById('evidence-dialog').close()`);

    // 3 Ask
    await clickNav('Ask');
    await clickText('Who and when is the clinic visit?');
    await waitFor(`!!document.querySelector('.answer')`, 'answer');
    check('answer shows ambiguity + caveat, offers a plan, nothing saved', await ev(`!!document.querySelector('.unc-ambiguous') && document.body.innerText.includes('AM or PM must be checked') && document.body.innerText.includes('Make it a plan?') && !document.body.innerText.includes('Saved to calendar')`));
    await shot('04-answer-en'); await noOverflow('answer');
    await clickText('What was the medicine name?');
    await waitFor(`document.querySelector('.answer')?.textContent.includes('The speaker is not known')`, 'unknown speaker caveat');
    check('unknown speaker is flagged', true);
    await clickText('What do I need to do this week?');
    await waitFor(`document.querySelector('.answer')?.textContent.includes("I won't guess")`, 'not found answer');
    check('unanswerable question says it will not guess', true);

    // 4 Proposal -> clarify (object candidates) -> confirm -> result
    await clickText('Who and when is the clinic visit?');
    await waitFor(`document.querySelector('.answer')?.textContent.includes('Make it a plan?')`, 'answer again');
    await clickText('Make it a plan?');
    await waitFor(`document.querySelector('.statecard.st-needs_info')`, 'needs_info card');
    check('proposal says not saved yet', await ev(`document.querySelector('.statecard').textContent.includes('Not saved yet')`));
    await shot('05-proposal-en'); await minTap('proposal');
    await clickText('What time?');
    await waitFor(`!!document.querySelector('#f-hour')`, 'form');
    check('object candidates rendered as chips (GAP3)', await ev(`[...document.querySelectorAll('.chip')].map(c=>c.textContent).join('|')`).then((s) => s.includes('Thu, Nov 12, 3:00 AM') && s.includes('Thu, Nov 12, 3:00 PM')));
    check('date prefilled from object when.value (GAP3)', await ev(`document.querySelector('#f-date').value === '2026-11-12'`));
    check('AM/PM not preselected', await ev(`![...document.querySelectorAll('[aria-pressed=true]')].some(b=>/^✓?(AM|PM)$/.test(b.textContent.trim()))`));
    check('time zone stated on the form', await ev(`document.body.innerText.includes('Seoul time (Asia/Seoul, UTC+9)')`));
    await setTime(3, 0);
    await clickText('Save and review');
    check('save refused without AM/PM', await ev(`document.body.innerText.includes('Choose AM or PM') && !!document.querySelector('#f-hour')`));
    await shot('06-clarify-refused-en');
    await clickText('Thu, Nov 12, 3:00 PM');
    check('tapping the labelled PM candidate selects PM explicitly', await ev(`[...document.querySelectorAll('[aria-pressed=true]')].some(b=>b.textContent.trim().endsWith('PM'))`));
    await clickText('Save and review');
    await waitFor(`document.body.innerText.includes('Is this right?')`, 'confirm step');
    check('readback has person/date/time/time zone/action', await ev(`['Person','Date','Time','Time zone','Action'].every(k => [...document.querySelectorAll('.rb-row dt')].some(d=>d.textContent===k))`));
    check('readback says Thu Nov 12, 3:00 PM, Seoul time', await ev(`/Thu, Nov 12/.test(document.querySelector('.readback').textContent) && /3:00\\sPM/.test(document.querySelector('.readback').textContent) && document.querySelector('.readback').textContent.includes('Seoul time')`));
    check('simulation stated before confirm (server-style mode label)', await ev(`document.body.innerText.includes('Simulation only')`));
    await shot('07-confirm-en'); await primaryTall('confirm');
    await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('Yes, confirm')); b.click(); b.click(); })()`);
    await waitFor(`document.querySelector('.statecard.st-simulated_completed')`, 'result');
    check('result is simulated, never "saved"', await ev(`document.querySelector('.statecard').textContent.includes('Simulated') && !document.querySelector('.statecard').textContent.includes('Saved to calendar')`));
    await shot('08-result-simulated-en');
    await clickText('Preview notification');
    check('notification preview labelled preview-only', await ev(`document.querySelector('.notif')?.textContent.includes('not a real notification')`));
    await shot('09-notification-en');

    // 5 Plans
    await clickNav('Plans');
    await waitFor(`document.querySelector('h1').textContent.includes('Plans and to-dos')`, 'plans');
    check('plans shows one simulated item (no duplicates)', await ev(`document.querySelectorAll('article.statecard.st-simulated_completed').length === 1`));
    await shot('10-plans-en');

    // 6 Cancel truth: a cancelled proposal cannot be confirmed
    await open(''); await ingestSample('Sample 2');
    await clickNav('Ask');
    await ev(`(() => { const q=document.querySelector('#q'); q.value='When do I meet Dana at the library?'; q.dispatchEvent(new Event('input')); })()`);
    await clickExact('Ask');
    await waitFor(`document.querySelector('.answer')?.textContent.includes('Make it a plan?')`, 'library answer');
    await clickText('Make it a plan?'); await waitFor(`!!document.querySelector('.statecard')`, 'library proposal');
    await clickText('Cancel this proposal'); await clickText('Yes, discard');
    await waitFor(`!!document.querySelector('.statecard.st-cancelled')`, 'cancelled');
    check('cancel says nothing was sent; no confirm button remains', await ev(`document.body.innerText.includes('Nothing was sent') && ![...document.querySelectorAll('button')].some(b=>b.textContent.includes('Yes, confirm'))`));
    await shot('11-cancelled-en');

    // 7 Settings: language persists (saved choice), receipt honest
    await ev(`document.querySelector('.iconbtn').click()`);
    await waitFor(`document.querySelector('h1').textContent.includes('Settings and privacy')`, 'settings');
    check('capability list has roadmap + unverified labels; never calls 119', await ev(`!!document.querySelector('.cap-roadmap') && !!document.querySelector('.cap-unverified') && document.body.innerText.includes('never calls 119')`));
    check('settings show time zone explicitly', await ev(`document.body.innerText.includes('All times are Seoul time (Asia/Seoul, UTC+9)')`));
    await shot('12-settings-en'); await noOverflow('settings'); await minTap('settings');
    await clickText('한국어 (Korean)');
    await open('');
    check('saved Korean choice persists after reload', await ev(`document.documentElement.lang === 'ko' && document.querySelector('.privacybar').textContent.includes('마이크 꺼짐')`));
    await shot('13-home-ko'); await navFits('home KO');
    await ev(`document.querySelector('.iconbtn').click()`);
    await clickText('English');
    await open('');
    check('switching back to English persists', await ev(`document.documentElement.lang === 'en'`));
    await ingestSample('Sample 1');
    await ev(`document.querySelector('.iconbtn').click()`);
    await clickText('Delete everything'); await clickText('Delete everything');
    await waitFor(`!!document.querySelector('.receipt')`, 'receipt');
    check('receipt is partial (export not verified), not "all deleted"', await ev(`document.querySelector('.card .warn-strong')?.textContent.includes('Only partly') && !!document.querySelector('.rc-not_verified')`));

    // 8 150% text
    await open('&scale=1.5');
    check('150% scale applied', await ev(`getComputedStyle(document.documentElement).fontSize === '33px'`));
    await shot('14-home-en-150'); await noOverflow('home 150%'); await minTap('home 150%'); await navFits('home 150%');
    await open('&route=privacy&scale=1.5');
    await noOverflow('settings 150%'); await shot('15-settings-en-150');

    // 9 faults never read as success
    for (const [fault, cls, word] of [['failed', 'st-failed', 'Failed'], ['permission_denied', 'st-permission_denied', 'Permission'], ['unknown_outcome', 'st-unknown_outcome', 'unknown'], ['handed_off', 'st-handed_off', 'Handed off']]) {
      await open(`&fault=${fault}`);
      await ingestSample('Sample 1'); await planFromClinicQuestion();
      await clickText('What time?'); await waitFor(`!!document.querySelector('#f-hour')`, 'form');
      await clickText('Thu, Nov 12, 3:00 PM'); await clickText('Save and review');
      await waitFor(`document.body.innerText.includes('Is this right?')`, 'confirm');
      await clickText('Yes, confirm');
      await waitFor(`!!document.querySelector('.statecard.${cls}')`, `result ${fault}`);
      const text = await ev(`document.querySelector('.statecard.${cls}').textContent`);
      check(`fault ${fault} renders ${cls} and never says saved`, text.toLowerCase().includes(word.toLowerCase()) && !/Saved to calendar/i.test(text), text.slice(0, 80));
      await shot(`16-fault-${fault}-en`);
    }
    await open('&fault=real_ok');
    await ingestSample('Sample 1'); await planFromClinicQuestion();
    await clickText('What time?'); await waitFor(`!!document.querySelector('#f-hour')`, 'form');
    await clickText('Thu, Nov 12, 3:00 PM'); await clickText('Save and review');
    await waitFor(`document.body.innerText.includes('Is this right?')`, 'confirm');
    await clickText('Yes, confirm'); await waitFor(`!!document.querySelector('.statecard.st-completed_external')`, 'completed_external (TEST fixture)');
    check('only a verified-real record renders "Saved to calendar (verified)"', await ev(`document.querySelector('.statecard.st-completed_external').textContent.includes('Saved to calendar (verified)')`));
    await shot('17-completed-external-TESTONLY-en');
  }

  // 10 LIVE English run against the real server (model route; slow)
  if (liveArg) {
    const before = problems.length;
    const ref = String(Date.now()).slice(-6);
    const text = [
      `Maria: Hi Tom, it's Maria from Riverside Community Center, message ${ref}.`,
      'Maria: Your hearing check moved to next Wednesday at 4.',
      'Tom: Wednesday at 4 works. Is that in the morning or the afternoon?',
      'Maria: I will check and call you back.',
      'Tom: Thanks. My son Alex will drive me.',
    ].join('\n');
    await open('&api=live', liveArg, '/');
    check('LIVE: fresh English UI, Live AI pill', await ev(`document.documentElement.lang === 'en' && document.querySelector('.modepill')?.textContent.includes('Live')`), await ev(`document.querySelector('.modepill')?.textContent + ' / ' + document.querySelector('.modepill')?.title`));
    await ev(`(() => { const t=document.querySelector('#conv-text'); t.value=${JSON.stringify(text)}; t.dispatchEvent(new Event('input')); document.querySelector('#consent').click(); })()`);
    await clickText('Read this conversation');
    const tIngest = await waitFor(`document.querySelectorAll('article.mem').length >= 1 || !!document.querySelector('.errorbox')`, 'live memories', 160000);
    const memText = await body();
    check('LIVE: new English text became source-linked memories', await ev(`document.querySelectorAll('article.mem').length >= 1 && [...document.querySelectorAll('button')].some(b=>b.textContent.includes('See the source'))`), `${Math.round(tIngest / 1000)}s; ${(memText.match(/Analyzed by[^\n]*/) ?? [''])[0]}`);
    check('LIVE: no [object Object] in memories', !memText.includes('[object Object]'));
    await shot('20-live-memories-en');
    await clickNav('Ask');
    await ev(`(() => { const q=document.querySelector('#q'); q.value='When is my hearing check, and who is driving me?'; q.dispatchEvent(new Event('input')); })()`);
    await clickExact('Ask');
    const tAsk = await waitFor(`!!document.querySelector('.answer') || !!document.querySelector('.errorbox')`, 'live answer', 160000);
    const ansText = await ev(`document.querySelector('.answer')?.innerText ?? document.querySelector('.errorbox')?.innerText`);
    check('LIVE: English answer with who/when slots', /When/.test(ansText ?? '') && !/\[object Object\]/.test(ansText ?? ''), `${Math.round(tAsk / 1000)}s; ${(ansText ?? '').replace(/\s+/g, ' ').slice(0, 220)}`);
    await shot('21-live-answer-en');
    if (await clickText('Make it a plan?')) {
      await waitFor(`!!document.querySelector('.statecard') || !!document.querySelector('.errorbox')`, 'live proposal', 60000);
      await shot('22-live-proposal-en');
      if (await clickText('What time?')) {
        await waitFor(`!!document.querySelector('#f-hour')`, 'live form', 20000);
        const chips = await ev(`[...document.querySelectorAll('.chip')].map(c=>c.textContent)`);
        check('LIVE: clarification shows object candidates as labelled chips (GAP3)', chips.length >= 1 && chips.every((c) => c && !c.includes('[object')), JSON.stringify(chips));
        check('LIVE: AM/PM not preselected', await ev(`![...document.querySelectorAll('[aria-pressed=true]')].some(b=>/^✓?(AM|PM)$/.test(b.textContent.trim()))`));
        await shot('23-live-clarify-en');
        const pm = chips.find((c) => /PM/.test(c));
        if (pm) await clickText(pm); else { await setTime(4, 0); await clickExact('PM'); }
        if (!(await ev(`document.querySelector('#f-date').value`))) await ev(`(() => { const d=document.querySelector('#f-date'); d.value='2026-11-18'; d.dispatchEvent(new Event('change')); })()`);
        await clickText('Save and review');
      } else {
        await clickText('Review and confirm');
      }
      await waitFor(`document.body.innerText.includes('Is this right?') || !!document.querySelector('.errorbox')`, 'live confirm', 60000);
      const conf = await body();
      check('LIVE: confirm readback in English with Seoul time zone', conf.includes('Is this right?') && conf.includes('Seoul time (Asia/Seoul, UTC+9)'), (conf.match(/Simulation[^\n]*|Saved to the EBYS[^\n]*|Calendar file[^\n]*/) ?? [''])[0]);
      await shot('24-live-confirm-en');
      if (await clickText('Yes, confirm')) {
        await waitFor(`!!document.querySelector('.state-big') || !!document.querySelector('.errorbox')`, 'live result', 60000);
        const res = await ev(`document.querySelector('.state-big')?.innerText ?? document.querySelector('.errorbox')?.innerText`);
        check('LIVE: result state rendered via displayState (no false "saved")', !!res, res);
        await shot('25-live-result-en');
      }
    }
    // clean up ONLY this session on the shared server
    await ev(`document.querySelector('.iconbtn').click()`);
    if (await clickText('Delete the latest conversation')) { await clickText('Delete this conversation only'); await waitFor(`!!document.querySelector('.receipt') || !!document.querySelector('.errorbox')`, 'live receipt', 30000); }
    await shot('26-live-receipt-en');
    check('LIVE: no console errors', problems.length === before, problems.slice(before).join(' || '));
  }

  if (!onlyLive) check('no console errors / exceptions', problems.length === 0, problems.join(' || '));
} catch (e) {
  check('smoke run completed', false, String(e?.stack ?? e));
} finally {
  try { ws.close(); } catch { /* ignore */ }
  chrome.kill();
  server.close();
  await sleep(500);
  await rm(profile, { recursive: true, force: true }).catch(() => {});
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed; screenshots in ${outDir}`);
  process.exit(failed.length ? 1 : 0);
}
