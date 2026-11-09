// UI logic tests (no browser). Run: node --test ui/test/ui.test.mjs
// They prove UI plumbing only (labels, state rules, sample API, contrast tokens). They do NOT prove the AI works.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const uiRoot = join(here, '..');

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    if (n === 'test' || n === 'tools' || n === 'node_modules') continue;
    const p = join(dir, n);
    statSync(p).isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
}
const jsFiles = walk(uiRoot).filter((f) => f.endsWith('.js'));
const code = (f) => readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const i18n = await import('../i18n.js');
const { dictionaries } = i18n;
const { STATE_META } = await import('../components.js').catch(() => ({ STATE_META: null }));

// ---------------- English-first ----------------
test('English is the default language: i18n module, index.html, prefs (never navigator.language)', async () => {
  assert.equal(i18n.getLang(), 'en');
  const html = readFileSync(join(uiRoot, 'index.html'), 'utf8');
  assert.match(html, /<html lang="en">/);
  for (const f of jsFiles) assert.ok(!/navigator\.languages?\b/.test(code(f)), `${f} reads the browser locale`);
  const { loadPrefs } = await import('../lib/prefs.js');
  const mem = (v) => ({ getItem: () => v, setItem() {} });
  assert.deepEqual(loadPrefs('', mem(null)), { lang: 'en', scale: 1 }); // fresh storage
  assert.deepEqual(loadPrefs('', mem('not json')), { lang: 'en', scale: 1 });
  assert.deepEqual(loadPrefs('', mem('{"lang":"fr","scale":3}')), { lang: 'en', scale: 1 });
  assert.deepEqual(loadPrefs('', mem('{"lang":"ko","scale":1.25}')), { lang: 'ko', scale: 1.25 }); // explicit saved choice
  assert.equal(loadPrefs('?lang=en', mem('{"lang":"ko"}')).lang, 'en');
  assert.equal(loadPrefs('?lang=ko', null).lang, 'ko');
  assert.equal(loadPrefs('', null).lang, 'en'); // storage blocked
});

test('prefs store only lang + scale, under one key', async () => {
  const { savePrefs } = await import('../lib/prefs.js');
  const store = {};
  savePrefs({ lang: 'ko', scale: 1.5, text: 'secret transcript' }, { setItem: (k, v) => { store[k] = v; } });
  assert.deepEqual(Object.keys(store), ['ebys.prefs']);
  assert.deepEqual(JSON.parse(store['ebys.prefs']), { lang: 'ko', scale: 1.5 });
});

test('English copy is natural (no Korean in EN, no leftover dev jargon in key user strings)', () => {
  for (const [k, v] of Object.entries(dictionaries.en)) {
    if (k === 'hdr.langLabel' || k === 'hdr.lang' || k === 'settings.langKo') continue;
    assert.ok(!/[\uAC00-\uD7A3]/.test(v), `en:${k} contains Korean: ${v}`);
  }
  for (const k of ['a1.title', 'a1.lead', 'a1.analyze', 'home.hello', 'home.lead', 'a3.prompt', 'a4.confirmTitle', 'a4.clarifyLead', 'nav.input', 'mode.sample']) {
    assert.ok(!/FIXTURE|fixture|endpoint|payload|null|undefined/.test(dictionaries.en[k]), `en:${k} has jargon: ${dictionaries.en[k]}`);
  }
  assert.equal(dictionaries.en['tz.seoul'], 'Seoul time (Asia/Seoul, UTC+9)');
});

// ---------------- i18n integrity ----------------
test('ko and en dictionaries have identical keys and no empty strings (except st.none)', () => {
  const ko = Object.keys(dictionaries.ko).sort();
  const en = Object.keys(dictionaries.en).sort();
  assert.deepEqual(ko, en);
  for (const lang of ['ko', 'en']) {
    for (const [k, v] of Object.entries(dictionaries[lang])) {
      if (k === 'st.none') continue;
      assert.ok(typeof v === 'string' && v.trim().length > 0, `${lang}:${k} empty`);
    }
  }
});

test('every literal i18n key used in source exists', () => {
  const prefixes = 'a1|a2|a3|a4|a5|a6|prog|err|errc|ev|slot|unc|st|nav|hdr|privacy|chip|foot|notif|cap|app|voice|mic|rb|tz|caveat|home|mode|settings';
  const re = new RegExp(`['"\`]((?:${prefixes})\\.[A-Za-z0-9_]+(?:\\.[A-Za-z0-9_]+)?)['"\`]`, 'g');
  const missing = [];
  for (const f of jsFiles) {
    if (f.endsWith('i18n.js')) continue;
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(re)) if (!(m[1] in dictionaries.en)) missing.push(`${f}: ${m[1]}`);
  }
  assert.deepEqual(missing, []);
});

test('dynamic key families are complete (states, uncertainty, caveats, receipt stores/status, capabilities, kinds)', async () => {
  const c = await import('../../contracts/contracts.js').catch(() => null);
  const need = [];
  const metaKeys = Object.keys(STATE_META ?? {}).filter((k) => k !== 'none');
  assert.ok(metaKeys.length > 10, 'STATE_META not loadable');
  for (const k of metaKeys) need.push(`st.${k}`);
  for (const u of ['stated', 'inferred', 'approximate', 'ambiguous', 'unknown', 'conflicting', 'superseded']) need.push(`unc.${u}`);
  for (const k of ['all', 'event', 'task', 'person', 'fact']) need.push(`a2.${k}`);
  for (const k of ['who', 'when', 'where', 'what']) need.push(`slot.${k}`);
  for (const k of ['speaker_unknown', 'unconfirmed', 'single_source', 'time_ambiguous', 'constraint_not_appointment', 'change_pending_user_decision']) need.push(`caveat.${k}`);
  for (const k of ['in_past', 'place_unknown', 'person_unknown']) need.push(`a4.warn.${k}`);
  for (const k of ['source_changed', 'stale_preview', 'needs_clarification', 'proposal_closed', 'not_found']) need.push(`errc.${k}`);
  const stores = c?.RECEIPT_STORES ?? ['transcript', 'memories', 'search_index', 'proposals', 'action_ledger', 'notification_queue', 'llm_cache', 'exported_file', 'external_calendar'];
  const statuses = c?.RECEIPT_STATUS ?? ['verified_deleted', 'not_deleted', 'not_verified', 'not_applicable'];
  for (const s of stores) need.push(`a6.store.${s}`);
  for (const s of statuses) need.push(`a6.status.${s}`);
  const { CAPABILITIES } = await import('../capabilities.js');
  for (const cap of CAPABILITIES) { need.push(cap.key); need.push(`cap.${cap.label}`); }
  const ds = ['needs_info', 'proposed', 'user_confirmed', 'executing', 'handed_off', 'completed_external', 'simulated_completed',
    'user_attested', 'failed', 'permission_denied', 'unknown_outcome', 'verify_mismatch', 'cancelled', 'expired'];
  for (const k of ds) need.push(`st.${k}`);
  assert.deepEqual(need.filter((k) => !(k in dictionaries.ko) || !(k in dictionaries.en)), []);
});

test('only completed_external may read as saved', () => {
  for (const lang of ['ko', 'en']) {
    for (const [k, v] of Object.entries(dictionaries[lang])) {
      if (!k.startsWith('st.') || k === 'st.completed_external') continue;
      if (lang === 'ko') assert.ok(!/\uC800\uC7A5\uB428/.test(v), `${lang}:${k} says saved: ${v}`);
      else if (/saved/i.test(v)) assert.ok(/not (really |yet verified |verified )?saved/i.test(v), `${lang}:${k} says saved: ${v}`);
    }
  }
});

// ---------------- safety ----------------
test('no innerHTML / eval / document.write in UI source (untrusted transcript text)', () => {
  for (const f of jsFiles) {
    const src = code(f);
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function\(/.test(src), `${f} uses unsafe sink`);
  }
});

test('no tel:/sms:/mailto: actions; storage only in lib/prefs.js; fetch only in liveApi.js', () => {
  for (const f of jsFiles) {
    const src = code(f);
    assert.ok(!/['"`](tel|sms|mailto):/.test(src), `${f} has external action scheme`);
    if (/[\\/]lib[\\/]prefs\.js$/.test(f)) continue;
    assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(src), `${f} persists data`);
  }
  const fetchers = jsFiles.filter((f) => /\bfetch\(/.test(readFileSync(f, 'utf8'))).map((f) => f.replace(uiRoot, ''));
  assert.ok(fetchers.every((f) => /liveApi\.js$/.test(f)), `fetch outside liveApi: ${fetchers}`);
  const css = readFileSync(join(uiRoot, 'styles.css'), 'utf8');
  assert.ok(!/@import|url\(\s*['"]?https?:|@font-face/.test(css), 'no network fonts/assets in CSS');
});

// ---------------- state rules ----------------
test('displayState mirror matches contracts.js for every combination', async () => {
  const path = join(uiRoot, '..', 'contracts', 'contracts.js');
  if (!existsSync(path)) return;
  const real = await import(pathToFileURL(path).href);
  const { displayStateLocal } = await import('../lib/contracts.js');
  for (const status of real.ACTION_STATUS) for (const mode of ['real', 'simulated']) for (const verifyLevel of real.VERIFY_LEVEL) {
    const rec = { status, mode, verifyLevel };
    assert.equal(displayStateLocal(rec), real.displayState(rec), JSON.stringify(rec));
  }
  assert.equal(displayStateLocal(null), real.displayState(null));
});

test('displayState: only real + readback completes as completed_external; simulated/handoff never read as saved', async () => {
  const { displayStateLocal: d } = await import('../lib/contracts.js');
  assert.equal(d({ status: 'completed', mode: 'real', verifyLevel: 'api_readback' }), 'completed_external');
  assert.equal(d({ status: 'completed', mode: 'real', verifyLevel: 'api_ack' }), 'unknown_outcome');
  assert.equal(d({ status: 'completed', mode: 'simulated', verifyLevel: 'device_readback' }), 'simulated_completed');
  assert.equal(d({ status: 'handed_off', mode: 'real', verifyLevel: 'handoff' }), 'handed_off');
  assert.equal(d({ status: 'failed' }), 'failed');
});

// ---------------- time ----------------
test('time helpers: AM/PM is mandatory and 12 AM/PM are right; Seoul time formatting', async () => {
  const { composeIso, parseIso, formatWhen } = await import('../lib/time.js');
  assert.equal(composeIso({ date: '2026-11-12', hour12: 3, minute: 0, ampm: null }), null);
  assert.equal(composeIso({ date: '2026-11-12', hour12: 3, minute: 0, ampm: '' }), null);
  assert.equal(composeIso({ date: '2026-11-12', hour12: 3, minute: 0, ampm: 'pm' }), '2026-11-12T15:00:00+09:00');
  assert.equal(composeIso({ date: '2026-11-12', hour12: 12, minute: 30, ampm: 'am' }), '2026-11-12T00:30:00+09:00');
  assert.equal(composeIso({ date: '2026-11-12', hour12: 12, minute: 0, ampm: 'pm' }), '2026-11-12T12:00:00+09:00');
  assert.equal(composeIso({ date: '', hour12: 3, minute: 0, ampm: 'pm' }), null);
  assert.equal(composeIso({ date: '2026-11-12', hour12: '', minute: 0, ampm: 'pm' }), null);
  assert.deepEqual(parseIso('2026-11-12T15:05:00+09:00'), { date: '2026-11-12', h24: 15, minute: 5, hour12: 3, ampm: 'pm' });
  assert.equal(parseIso('2026-11-12T15:05:00+01:00'), null); // never silently reinterpret another zone
  assert.equal(parseIso('2026-11-12'), null);
  assert.match(formatWhen('2026-11-12T15:00:00+09:00', 'en'), /Thu.*Nov.*12.*3:00\s?PM/);
  assert.match(formatWhen('2026-11-12T15:00:00+09:00', 'ko'), /11\uC6D4 12\uC77C \uBAA9\uC694\uC77C/);
});

// ---------------- GAP3: object-shaped candidates / slot values ----------------
test('GAP3 candidateOptions accepts legacy ISO strings AND core objects (incl. partial ones)', async () => {
  const { candidateOptions } = await import('../screens/proposal.js');
  const legacy = candidateOptions(['2026-11-12T03:00:00+09:00', '2026-11-12T15:00:00+09:00', '2026-11-12T15:00:00+09:00', 'garbage'], 'en');
  assert.equal(legacy.length, 2);
  assert.deepEqual(legacy[1].time, { hour12: 3, minute: 0, ampm: 'pm' });
  assert.equal(legacy[1].date, '2026-11-12');
  assert.match(legacy[1].label, /Thu.*Nov.*12.*3:00\s?PM/);
  const objs = candidateOptions([
    { date: '2026-11-12', time: '03:00', startIso: '2026-11-12T03:00:00+09:00', labelKo: '11\uC6D4 12\uC77C (\uBAA9) \uC624\uC804 3:00', labelEn: 'Thu, Nov 12, 3:00 AM' },
    { date: '2026-11-12', time: '15:00', startIso: '2026-11-12T15:00:00+09:00', labelKo: '11\uC6D4 12\uC77C (\uBAA9) \uC624\uD6C4 3:00', labelEn: 'Thu, Nov 12, 3:00 PM' },
    { date: null, time: '16:00', startIso: null, labelKo: '\uC624\uD6C4 4:00', labelEn: '4:00 PM' },
    { date: '2026-11-18', time: null, startIso: null, labelKo: '', labelEn: '' },
    { date: null, time: null, startIso: null, labelKo: '', labelEn: '' },
    null, 42,
  ], 'en');
  assert.deepEqual(objs.map((o) => o.label), ['Thu, Nov 12, 3:00 AM', 'Thu, Nov 12, 3:00 PM', '4:00 PM', objs[3].label]);
  assert.match(objs[3].label, /Wed.*Nov.*18/);
  assert.deepEqual(objs[1].time, { hour12: 3, minute: 0, ampm: 'pm' });
  assert.equal(objs[2].date, null); assert.deepEqual(objs[2].time, { hour12: 4, minute: 0, ampm: 'pm' });
  assert.equal(objs[3].time, null); // partial: date only, AM/PM left for the person
  const ko = candidateOptions([{ date: '2026-11-12', time: '15:00', startIso: '2026-11-12T15:00:00+09:00', labelKo: '11\uC6D4 12\uC77C (\uBAA9) \uC624\uD6C4 3:00', labelEn: 'x' }], 'ko');
  assert.equal(ko[0].label, '11\uC6D4 12\uC77C (\uBAA9) \uC624\uD6C4 3:00');
});

test('GAP3 whenSeed reads object when.value (date/time/startIso) and legacy strings; never invents AM/PM', async () => {
  const { whenSeed } = await import('../screens/proposal.js');
  assert.deepEqual(whenSeed({ value: { date: '2026-11-12', time: null, startIso: null } }), { date: '2026-11-12', time: null });
  assert.deepEqual(whenSeed({ value: { date: '2026-11-12', time: '15:30', startIso: '2026-11-12T15:30:00+09:00' } }), { date: '2026-11-12', time: { hour12: 3, minute: 30, ampm: 'pm' } });
  assert.deepEqual(whenSeed({ value: '2026-11-12' }), { date: '2026-11-12', time: null });
  assert.deepEqual(whenSeed({ value: null }), { date: null, time: null });
  assert.deepEqual(whenSeed(undefined), { date: null, time: null });
});

test('GAP3 integration: real core/time.mjs buildWhenSlot output feeds the form without auto-picking AM/PM', async () => {
  const core = await import('../../core/time.mjs');
  const { candidateOptions, whenSeed } = await import('../screens/proposal.js');
  const parts = [core.parseTimePhrase('next Wednesday at 4', '2026-11-09T12:00:00+09:00')];
  const when = core.buildWhenSlot(core.mergeParts(parts), { lang: 'en' });
  assert.equal(when.state, 'ambiguous');
  assert.ok(when.candidates.length >= 2 && when.candidates.every((c) => typeof c === 'object'));
  const seed = whenSeed(when);
  assert.equal(seed.time, null); // ambiguous hour: nothing preselected
  const opts = candidateOptions(when.candidates, 'en');
  assert.equal(opts.length, when.candidates.length);
  for (const o of opts) {
    assert.match(o.label, /\b(AM|PM)\b/); // the chip states its half of the day before it can set one
    assert.equal(o.time.ampm, /PM/.test(o.label) ? 'pm' : 'am');
  }
  const ko = candidateOptions(when.candidates, 'ko');
  assert.ok(ko.every((o) => /\uC624\uC804|\uC624\uD6C4/.test(o.label)));
});

test('GAP3 slotText renders core object/array shapes, never "[object Object]"', async () => {
  const { slotText } = await import('../components.js');
  const when = { state: 'ambiguous', display: '11\uC6D4 12\uC77C \uBAA9\uC694\uC77C 3\uC2DC\uCBE4', value: { date: '2026-11-12', time: null, displayEn: 'Thu, Nov 12, around 3', displayKo: '11\uC6D4 12\uC77C \uBAA9\uC694\uC77C 3\uC2DC\uCBE4' } };
  assert.equal(slotText(when, 'en'), 'Thu, Nov 12, around 3'); // UI language wins over the session language
  assert.equal(slotText(when, 'ko'), '11\uC6D4 12\uC77C \uBAA9\uC694\uC77C 3\uC2DC\uCBE4');
  assert.equal(slotText({ state: 'known', value: [{ name: 'Alex' }, { name: 'Dr. Kim' }] }, 'en'), 'Alex, Dr. Kim');
  assert.equal(slotText({ state: 'known', value: { name: 'Harbor Clinic' } }, 'en'), 'Harbor Clinic');
  assert.equal(slotText({ state: 'known', value: { text: 'checkup', title: { en: 'Checkup', ko: '\uAC74\uAC15\uAC80\uC9C4' } } }, 'ko'), '\uAC74\uAC15\uAC80\uC9C4');
  assert.equal(slotText({ state: 'known', value: 'x', display: 'Thursday' }, 'en'), 'Thursday');
  assert.equal(slotText({ state: 'known', value: '2026-11-12T15:00:00+09:00' }, 'en').includes('3:00'), true);
  assert.equal(slotText({ state: 'unknown', value: null }, 'en'), null);
  for (const v of [{}, { foo: 1 }, []]) assert.ok(!String(slotText({ state: 'known', value: v }, 'en')).includes('[object'));
});

test('normalizePreview accepts the real nested preview and the legacy flat one; digest passes through unchanged', async () => {
  const { normalizePreview } = await import('../lib/preview.js');
  const live = normalizePreview({
    proposalId: 'p1', revision: 2, previewDigest: 'd-abc',
    preview: { mode: 'simulated', adapterId: 'calendar.sim', fields: { kind: 'appointment', title: 'Checkup', who: 'Alex', startsAt: '2026-11-12T15:00:00+09:00', reminders: [60], tz: 'Asia/Seoul' },
      modeLabel: { en: 'Simulation only', ko: '\uC2DC\uBBAC\uB808\uC774\uC158' }, warnings: [{ code: 'place_unknown', message: { en: 'No place has been set.', ko: '\uC7A5\uC18C \uBBF8\uC815' } }], notifications: [{ fireAt: '2026-11-12T14:00:00+09:00' }] },
  });
  assert.equal(live.title, 'Checkup'); assert.equal(live.who, 'Alex'); assert.deepEqual(live.reminders, [60]);
  assert.equal(live.previewDigest, 'd-abc'); assert.equal(live.mode, 'simulated'); assert.equal(live.modeLabel.en, 'Simulation only');
  assert.equal(live.warnings[0].code, 'place_unknown'); assert.equal(live.notifications.length, 1);
  const flat = normalizePreview({ title: 'T', startsAt: null, remindOffsetsMin: [1440], previewDigest: 'x' });
  assert.equal(flat.title, 'T'); assert.deepEqual(flat.reminders, [1440]); assert.equal(flat.previewDigest, 'x'); assert.deepEqual(flat.warnings, []);
  assert.equal(normalizePreview(null), null);
});

// ---------------- design tokens ----------------
function lum(hex) {
  const n = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('colour token pairs meet AAA text contrast (>= 7:1); borders/focus meet 3:1', () => {
  const css = readFileSync(join(uiRoot, 'styles.css'), 'utf8');
  const v = Object.fromEntries([...css.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
  const text = [
    ['text', 'bg'], ['text', 'paper'], ['text', 'sand'], ['muted', 'bg'], ['muted', 'paper'], ['muted', 'sand'], ['primary-fg', 'primary'], ['link', 'bg'], ['link', 'paper'],
    ['navy', 'ivory'], ['navy', 'paper'], ['navy', 'sand'], ['ivory', 'navy'], ['gold-on-navy', 'navy'], ['ivory', 'navy-deep'],
    ['danger', 'bg'], ['danger', 'paper'], ['danger', 'danger-bg'], ['warn', 'warn-bg'], ['warn', 'paper'], ['ok', 'bg'], ['ok', 'ok-bg'], ['ok', 'paper'],
    ['fixture', 'fixture-bg'], ['fixture', 'paper'], ['model', 'model-bg'], ['fallback', 'fallback-bg'], ['neutral', 'neutral-bg'], ['neutral', 'paper'],
    ['bar-off', 'bar-off-bg'], ['bar-off', 'bar-listen-bg'], ['text', 'warn-bg'], ['muted', 'neutral-bg'], ['text', 'model-bg'], ['muted', 'danger-bg'], ['navy', 'model-bg'],
  ];
  const lits = [['#00404a', '#e0f4f6'], ['#5a2400', '#ffe6d1'], ['#3d1f66', '#f3ecfb'], ['#3d1f66', '#e4d8f5']];
  const fails = [];
  for (const [a, b] of text) { if (!v[a] || !v[b]) { fails.push(`missing token ${a}/${b}`); continue; } if (ratio(v[a], v[b]) < 7) fails.push(`${a}/${b} ${ratio(v[a], v[b]).toFixed(2)}`); }
  for (const [a, b] of lits) if (ratio(a, b) < 7) fails.push(`${a}/${b} ${ratio(a, b).toFixed(2)}`);
  for (const [a, b] of [['line', 'bg'], ['line', 'paper'], ['focus', 'bg'], ['focus', 'paper']]) if (ratio(v[a], v[b]) < 3) fails.push(`${a}/${b} < 3`);
  assert.deepEqual(fails, []);
});

test('CSS keeps 22px base, 56px+ targets, 64px+ primary, visible focus and reduced motion; zoom not disabled', () => {
  const css = readFileSync(join(uiRoot, 'styles.css'), 'utf8');
  assert.match(css, /html\s*{[^}]*font-size:\s*calc\(22px \* var\(--scale\)\)/);
  assert.match(css, /--tap:\s*2\.6rem/); // 57.2px at 100%
  assert.match(css, /--tap-primary:\s*2\.95rem/); // 64.9px at 100%
  assert.match(css, /\.btn-primary\s*{[^}]*min-height:\s*var\(--tap-primary\)/);
  assert.match(css, /:focus-visible\s*{[^}]*outline:\s*4px solid/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  const html = readFileSync(join(uiRoot, 'index.html'), 'utf8');
  assert.ok(!/user-scalable\s*=\s*no|maximum-scale\s*=\s*1(?!\.)/.test(html), 'zoom must not be disabled');
});

test('brand assets: original SVG mark + logo exist and the favicon points to them', () => {
  const mark = readFileSync(join(uiRoot, 'assets', 'ebys-mark.svg'), 'utf8');
  const logo = readFileSync(join(uiRoot, 'assets', 'ebys-logo.svg'), 'utf8');
  assert.match(mark, /<svg[^>]+viewBox="0 0 64 64"/); assert.match(mark, /<title/);
  assert.match(logo, /EVER BY YOUR SIDE/);
  for (const s of [mark, logo]) assert.ok(!/<script|xlink:href="http|href="http/.test(s), 'SVG must be inert and offline');
  const html = readFileSync(join(uiRoot, 'index.html'), 'utf8');
  assert.match(html, /rel="icon" type="image\/svg\+xml" href="assets\/ebys-mark\.svg"/);
  assert.match(html, /<title>EBYS/);
  assert.ok(!/Jarvis|\uC790\uBE44\uC2A4/i.test(html));
  for (const lang of ['ko', 'en']) for (const [k, v] of Object.entries(dictionaries[lang])) assert.ok(!/Jarvis|\uC790\uBE44\uC2A4/i.test(v), `${lang}:${k} has old brand`);
  assert.equal(dictionaries.en['app.name'], 'EBYS'); assert.equal(dictionaries.ko['app.name'], 'EBYS');
});

// ---------------- sample (fixture) API end to end: UI plumbing, not AI ----------------
test('sample flow (core-shaped): ingest -> memories -> query(memoryId) -> propose -> AM/PM required -> nested preview -> idempotent confirm -> simulated', async () => {
  const { createFixtureApi } = await import('../services/fixtureApi.js');
  const { SAMPLES } = await import('../samples.js');
  const { displayStateLocal } = await import('../lib/contracts.js');
  const { normalizePreview } = await import('../lib/preview.js');
  const { candidateOptions } = await import('../screens/proposal.js');
  const api = createFixtureApi({ latency: 0 });
  const ing = await api.ingest({ title: 't', text: SAMPLES.sample1.text, provenance: 'synthetic' });
  assert.ok(ing.ok); assert.equal(ing.data.mode, 'fixture'); assert.equal(ing.data.memoriesCreated, 3);
  const utts = new Map(ing.data.utterances.map((u) => [u.id, u]));
  const mem = (await api.memories()).data;
  for (const m of mem) for (const e of m.evidence) assert.equal(utts.get(e.utteranceId).text.slice(e.charStart, e.charEnd), e.quote);
  const fri = mem.find((m) => m.summary.en.includes('Friday'));
  assert.equal(fri.status, 'superseded'); assert.ok(fri.supersededBy);
  const thu = mem.find((m) => m.id === fri.supersededBy);
  assert.equal(typeof thu.when.value, 'object'); assert.equal(thu.when.value.date, '2026-11-12');
  assert.equal(candidateOptions(thu.when.candidates, 'en').length, 2);
  const unknown = await api.query({ text: 'What do I need to do this week?', lang: 'en' });
  assert.equal(unknown.data.found, false);
  const med = (await api.query({ text: 'What was the medicine name?', lang: 'en' })).data;
  assert.ok(med.caveats.includes('speaker_unknown'));
  const ans = (await api.query({ text: 'Who and when is the clinic visit?', lang: 'en' })).data;
  assert.equal(ans.found, true); assert.equal(ans.proposal, undefined); assert.equal(ans.memoryId, thu.id);
  assert.ok(ans.caveats.includes('time_ambiguous'));
  assert.equal(ans.clarification.options[1].labelEn, 'Thu, Nov 12, 3:00 PM');
  assert.equal((await api.propose({ memoryId: fri.id })).error.code, 'memory_not_active');
  const prop = (await api.propose({ memoryId: ans.memoryId })).data;
  assert.equal(prop.state, 'needs_info'); assert.deepEqual(prop.missing, ['when.time']);
  const pv0 = (await api.preview({ proposalId: prop.id })).data;
  assert.ok(pv0.needs_clarification, 'ambiguous time must force clarification');
  const upd = (await api.updateProposal(prop.id, { startsAt: '2026-11-12T15:00:00+09:00' })).data;
  assert.equal(upd.state, 'proposed'); assert.equal(upd.revision, 2);
  const raw = (await api.preview({ proposalId: upd.id })).data;
  const pv = normalizePreview(raw);
  assert.ok(raw.preview.fields, 'preview is nested like the real server');
  assert.equal(pv.previewDigest, raw.previewDigest); assert.equal(pv.modeLabel.en.startsWith('Simulation only'), true);
  const bad = await api.confirm({ proposalId: upd.id, previewDigest: 'wrong' });
  assert.equal(bad.ok, false); assert.equal(bad.error.code, 'stale_preview');
  const c1 = (await api.confirm({ proposalId: upd.id, previewDigest: pv.previewDigest })).data;
  const c2 = (await api.confirm({ proposalId: upd.id, previewDigest: pv.previewDigest })).data;
  assert.equal(c1.recordId, c2.recordId);
  assert.equal(displayStateLocal(c1), 'simulated_completed');
  assert.match(c1.readbackText.en, /nothing was saved/);
  const rcpt = (await api.remove({ all: true })).data;
  assert.equal(rcpt.allVerified, false);
  assert.equal((await api.memories()).data.length, 0);
});

test('cancel truth: a cancelled proposal cannot be previewed or confirmed', async () => {
  const { createFixtureApi } = await import('../services/fixtureApi.js');
  const { SAMPLES } = await import('../samples.js');
  const api = createFixtureApi({ latency: 0 });
  await api.ingest({ text: SAMPLES.sample2.text, provenance: 'synthetic' });
  const ans = (await api.query({ text: 'When do I meet Dana at the library?', lang: 'en' })).data;
  const p = (await api.propose({ memoryId: ans.memoryId })).data;
  await api.updateProposal(p.id, { startsAt: '2026-11-11T14:00:00+09:00' });
  const pv = (await api.preview({ proposalId: p.id })).data;
  assert.equal((await api.cancelProposal(p.id)).data.state, 'cancelled');
  assert.equal((await api.preview({ proposalId: p.id })).error.code, 'proposal_closed');
  assert.equal((await api.confirm({ proposalId: p.id, previewDigest: pv.previewDigest })).error.code, 'proposal_closed');
  assert.equal((await api.updateProposal(p.id, { title: 'x' })).error.code, 'proposal_closed');
});

test('sample mode does not pretend to read new text', async () => {
  const { createFixtureApi } = await import('../services/fixtureApi.js');
  const api = createFixtureApi({ latency: 0 });
  const r = await api.ingest({ text: 'A: hello there\nB: new unseen text', provenance: 'synthetic' });
  assert.equal(r.data.memoriesCreated, 0);
  assert.equal(r.data.mode, 'fixture');
});

test('sample faults never read as success', async () => {
  const { createFixtureApi } = await import('../services/fixtureApi.js');
  const { SAMPLES } = await import('../samples.js');
  const { displayStateLocal } = await import('../lib/contracts.js');
  for (const [fault, expect] of [['failed', 'failed'], ['permission_denied', 'permission_denied'], ['unknown_outcome', 'unknown_outcome'], ['handed_off', 'handed_off']]) {
    const api = createFixtureApi({ latency: 0, fault });
    await api.ingest({ text: SAMPLES.sample2.text, provenance: 'synthetic' });
    const ans = (await api.query({ text: 'where do we meet', lang: 'en' })).data;
    const p = (await api.propose({ memoryId: ans.memoryId })).data;
    await api.updateProposal(p.id, { startsAt: '2026-11-11T14:00:00+09:00' });
    const pv = (await api.preview({ proposalId: p.id })).data;
    const rec = (await api.confirm({ proposalId: p.id, previewDigest: pv.previewDigest })).data;
    assert.equal(displayStateLocal(rec), expect);
    assert.notEqual(displayStateLocal(rec), 'completed_external');
  }
});

test('api selector: sample by default, live only with ?api=live', async () => {
  const { selectApi } = await import('../services/api.js');
  assert.equal(selectApi('').kind, 'fixture');
  assert.equal(selectApi('?api=live').kind, 'live');
  assert.equal(selectApi('?api=other').kind, 'fixture');
});

// ---------------- speech ----------------
test('speech: read-aloud follows UI language, is slow, cancels first, and fails safe', async () => {
  const sp = await import('../lib/speech.js');
  const calls = [];
  globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  globalThis.speechSynthesis = { cancel: () => calls.push('cancel'), speak: (u) => calls.push(`speak:${u.lang}:${u.rate}:${u.text}`), getVoices: () => [{ lang: 'ko-KR' }] };
  assert.equal(sp.speak('\uC548\uB155\uD558\uC138\uC694', 'ko'), true);
  assert.equal(sp.speak('hello', 'en'), true);
  assert.deepEqual(calls, ['cancel', 'speak:ko-KR:0.9:\uC548\uB155\uD558\uC138\uC694', 'cancel', 'speak:en-US:0.9:hello']);
  assert.equal(sp.speak('   ', 'en'), false);
  assert.equal(sp.voiceFor('ko'), 'yes');
  assert.equal(sp.voiceFor('en'), 'no'); // honest: no English voice installed => say so
  globalThis.speechSynthesis.getVoices = () => [];
  assert.equal(sp.voiceFor('en'), 'unknown');
  globalThis.speechSynthesis.speak = () => { throw new Error('boom'); };
  assert.equal(sp.speak('x', 'en'), false);
  delete globalThis.speechSynthesis; delete globalThis.SpeechSynthesisUtterance;
  assert.equal(sp.ttsAvailable(), false);
  assert.equal(sp.speak('x', 'en'), false);
  assert.equal(sp.voiceFor('en'), 'no');
});

test('speech input: absent API => false; present API => en-US, never auto-sends, returns text only', async () => {
  const sp = await import('../lib/speech.js');
  delete globalThis.SpeechRecognition; delete globalThis.webkitSpeechRecognition;
  assert.equal(sp.recognitionCtor(), null);
  assert.equal(sp.startListening('en', {}), false);
  let created;
  globalThis.webkitSpeechRecognition = class { constructor() { created = this; } start() { this.started = true; } stop() { this.onend(); } };
  let got = null; let ended = false;
  assert.equal(sp.startListening('en', { onText: (x) => { got = x; }, onEnd: () => { ended = true; } }), true);
  assert.equal(created.lang, 'en-US'); assert.equal(created.continuous, false); assert.equal(created.started, true);
  created.onresult({ results: [[{ transcript: 'who is the doctor' }]] });
  sp.stopListening();
  assert.equal(got, 'who is the doctor'); assert.equal(ended, true);
  delete globalThis.webkitSpeechRecognition;
});

test('spoken answer/readback (English) use the same words as the screen, include unknowns and the time zone', async () => {
  const { answerSpeech } = await import('../screens/ask.js');
  const { readbackSpeech, readbackRows } = await import('../screens/proposal.js');
  const a = { found: true, sentence: { ko: '\uBAA9\uC694\uC77C\uC774\uC5D0\uC694', en: 'It is Thursday' }, slots: { when: { state: 'known', display: 'x' }, who: { state: 'unknown' } } };
  const s = answerSpeech(a);
  assert.match(s, /It is Thursday/); assert.match(s, /Who: Unknown/); assert.match(s, /Where: Unknown/); assert.doesNotMatch(s, /When: Unknown/);
  assert.match(answerSpeech({ found: false, slots: {} }), /I won't guess/);
  const rows = readbackRows({ fields: { kind: 'appointment', title: 't', who: 'Mr. Lee', startsAt: '2026-11-12T15:00:00+09:00', remindOffsetsMin: [1440] }, preview: null, record: null });
  const r = readbackSpeech(rows);
  for (const word of ['Person: Mr. Lee', 'Date: Thu, Nov 12', 'Time: 3:00', 'PM', 'Time zone: Seoul time (Asia/Seoul, UTC+9)', 'Place: Unknown', 'No real calls or messages will be sent.']) assert.ok(r.includes(word), `${word} :: ${r}`);
});
