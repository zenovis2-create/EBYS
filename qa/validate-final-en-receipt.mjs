// Offline receipt checks only: no HTTP, model, browser, calendar or process-control calls.
import { readFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateAnswer, evaluateModelEvidence } from './run-heldout.mjs';

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const REQUIRED_GATES = [
  'EN_DEFAULT', 'EN_FLOW_COPY_VOICE', 'LIVE_EN_HELDOUT', 'UNKNOWN_RELEVANCE',
  'GAP12_SYNTHETIC', 'GAP3_OBJECT_CANDIDATE', 'CONFIRM_BINDING', 'LOCAL_CALENDAR_READBACK',
  'CANCEL_IDEMPOTENCY', 'ERROR_HONESTY', 'MOBILE_390', 'KEYBOARD_TARGETS_ZOOM', 'REDUCED_MOTION', 'RAW_CAPTURE',
];
const hash = value => createHash('sha256').update(value).digest('hex');
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
const unwrap = value => value?.body?.data ?? value?.data ?? value;
const within = (root, path) => { const rel = relative(root, path); return rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel); };
async function loadLocalArtifact(spec) {
  if (!spec || typeof spec.path !== 'string' || isAbsolute(spec.path)) throw new Error('Artifact path must be project-relative');
  if (spec.path.split(/[\\/]/).some(p => ['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.venv', '__pycache__'].includes(p))) throw new Error('Excluded artifact path');
  const path = resolve(PROJECT, spec.path);
  if (!within(PROJECT, path) || !within(await realpath(PROJECT), await realpath(path))) throw new Error('Artifact escapes project');
  return readFile(path);
}
function pointer(value, path) {
  if (typeof path !== 'string' || !path.startsWith('/')) return undefined;
  for (const token of path.slice(1).split('/').map(p => p.replaceAll('~1', '/').replaceAll('~0', '~'))) {
    if (value == null || !Object.hasOwn(value, token)) return undefined;
    value = value[token];
  }
  return value;
}
const dateMs = value => typeof value === 'string' ? Date.parse(value) : NaN;

export async function validateFinalReceipt(receipt, { loadArtifact = loadLocalArtifact } = {}) {
  const errors = [], pending = [], cache = new Map();
  const demand = (condition, message) => { if (!condition) errors.push(message); };
  const artifacts = receipt?.artifacts ?? {};
  async function artifact(id, kind) {
    if (!id || !Object.hasOwn(artifacts, id)) { errors.push(`Missing artifact: ${id ?? '(unset)'}`); return null; }
    const spec = artifacts[id];
    if (kind && spec.kind !== kind) errors.push(`${id}: expected ${kind} artifact`);
    if (cache.has(id)) return cache.get(id);
    try {
      if (!validHash(spec.sha256) || !spec.producer) throw new Error('sha256/producer missing');
      const bytes = Buffer.from(await loadArtifact(spec));
      if (hash(bytes) !== spec.sha256.toLowerCase()) throw new Error('Artifact hash mismatch');
      let value = bytes;
      if (spec.kind === 'json') value = JSON.parse(bytes.toString('utf8'));
      else if (spec.kind === 'tap' || spec.kind === 'text') value = bytes.toString('utf8');
      else if (spec.kind === 'image') {
        const signature = bytes.subarray(0, 16);
        if (!(signature.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          || signature.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
          || (signature.toString('ascii', 0, 4) === 'RIFF' && signature.toString('ascii', 8, 12) === 'WEBP'))) throw new Error('Unsupported raw image signature');
      } else if (spec.kind === 'video') {
        if (!(bytes.toString('ascii', 4, 8) === 'ftyp' || bytes.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163])))) throw new Error('Unsupported video signature');
      } else throw new Error('Unknown artifact kind');
      cache.set(id, value);
      return value;
    } catch (error) { errors.push(`${id}: ${error.message}`); cache.set(id, null); return null; }
  }
  demand(receipt?.schemaVersion === 1 && receipt?.scope === 'final-en-local', 'Unsupported schemaVersion/scope');
  demand(receipt?.preparedBy === 'sj-qa', 'Receipt preparer must be sj-qa');
  demand(typeof receipt?.runId === 'string' && receipt.runId.trim().length > 0, 'runId required');
  const gates = Array.isArray(receipt?.gates) ? receipt.gates : [];
  demand(new Set(gates.map(g => g.id)).size === gates.length, 'Duplicate gate ID');
  for (const gate of gates) demand(REQUIRED_GATES.includes(gate.id), `Unknown gate ${gate.id}`);
  for (const id of REQUIRED_GATES) {
    const gate = gates.find(g => g.id === id);
    if (!gate) { pending.push(`${id}: missing`); continue; }
    demand(['PASS', 'FAIL', 'BLOCKED', 'NOT_RUN'].includes(gate.status), `${id}: invalid status`);
    if (gate.status === 'FAIL') errors.push(`${id}: recorded FAIL`);
    if (gate.status !== 'PASS') { pending.push(`${id}: ${gate.status}`); continue; }
    demand(Boolean(gate.owner) && Boolean(gate.reviewedBy) && gate.owner !== gate.reviewedBy, `${id}: separate maker/reviewer required`);
    demand(Array.isArray(gate.evidence) && gate.evidence.length > 0, `${id}: evidence required`);
    for (const ref of gate.evidence ?? []) await artifact(ref);
    const d = gate.details ?? {};
    if (id === 'EN_DEFAULT') {
      demand(d.freshStorage === true && d.manualToggle === false && d.renderedLang === 'en'
        && d.optionalKo === true && typeof d.navigatorLocale === 'string', 'EN_DEFAULT: fresh English default proof missing');
      try { const url = new URL(d.url); demand(!url.searchParams.has('lang') && (url.pathname === '/' || url.pathname.startsWith('/ui/')) && d.apiMode === 'live', 'EN_DEFAULT: manual language override/sample mode is not default/live proof'); }
      catch { errors.push('EN_DEFAULT: URL required'); }
    }
    if (id === 'EN_FLOW_COPY_VOICE') demand(d.naturalEnglishReviewed === true && d.textAlternative === true
      && d.capabilityLabelsHonest === true && d.timezoneVisible === true && ['unverified', 'unsupported', 'device-tested'].includes(d.voiceStatus), 'English copy/voice/timezone evidence incomplete');
    if (id === 'GAP12_SYNTHETIC') {
      const tap = await artifact(d.tapArtifact, 'tap');
      demand(d.modelKind === 'synthetic-fake-llm', 'GAP12: must be labelled synthetic/fake, never live');
      demand(typeof tap === 'string' && /# tests 12\b/.test(tap) && /# pass 12\b/.test(tap) && /# fail 0\b/.test(tap)
        && /GAP-1/.test(tap) && /GAP-2/.test(tap), 'GAP12: exact 12/12 TAP including GAP-1/GAP-2 required');
    }
    if (id === 'GAP3_OBJECT_CANDIDATE') {
      const raw = await artifact(d.candidateArtifact, 'json');
      const candidates = pointer(raw, d.candidatePointer);
      const instants = Array.isArray(candidates) ? candidates.map(c => typeof c === 'object' && c !== null ? c.startIso ?? c.value?.startIso : null) : [];
      demand(instants.length >= 2 && instants.every(i => typeof i === 'string') && instants.includes(d.selectedIso)
        && d.datePreserved === true && d.ampmInitiallyUnselected === true && d.explicitChoice === true, 'GAP3: raw object candidates + explicit choice proof required');
    }
    if (id === 'CONFIRM_BINDING') demand(d.digestBound === true && d.revisionBound === true
      && d.editRevokesConfirmation === true && d.consequentialReadbackEnglish === true, 'Confirm binding/readback evidence incomplete');
    if (id === 'LOCAL_CALENDAR_READBACK') {
      const record = unwrap(await artifact(d.recordArtifact, 'json'));
      const disk = await artifact(d.diskArtifact, 'json');
      const expected = d.expected;
      const event = disk?.events?.find(e => e.intentId === record?.intentId && e.revision === record?.revision);
      demand(record?.adapterId === 'calendar.local' && record?.mode === 'real' && record?.status === 'completed'
        && record?.verifyLevel === 'api_readback', 'Local save needs real calendar.local completed + api_readback');
      demand(expected && ['title', 'startsAt', 'who', 'where', 'reminders'].every(k => Object.hasOwn(expected, k)), 'Local readback expected fields missing');
      for (const key of ['title', 'startsAt', 'who', 'where', 'reminders']) {
        const a = expected?.[key], b = record?.readback?.[key], c = key === 'where' ? event?.location ?? null : event?.[key];
        const same = (x, y) => key === 'reminders' ? Array.isArray(x) && Array.isArray(y) && JSON.stringify([...x].sort()) === JSON.stringify([...y].sort())
          : key === 'startsAt' ? Number.isFinite(dateMs(x)) && dateMs(x) === dateMs(y) : (x ?? null) === (y ?? null);
        demand(same(a, b) && same(a, c), `Local disk/readback mismatch: ${key}`);
      }
      demand(event?.start === event?.startsAt?.slice(0, 16) && d.phoneCalendarClaim === false
        && d.notificationClaim === 'in-app-only', 'Local calendar alias/phone/notification claim mismatch');
    }
    if (id === 'CANCEL_IDEMPOTENCY') demand(d.staleConfirmRejected === true && d.duplicateWrites === 0
      && d.sameRecordOnDuplicate === true && d.cancelledEntryAbsentOnReadback === true && d.cancelledReminderCount === 0, 'Cancel/idempotency/readback evidence incomplete');
    if (id === 'ERROR_HONESTY') demand(d.permissionFailureNoSuccess === true && d.preSendRetryOnly === true
      && d.postSendRetryDisabled === true && d.reconciliationRequired === true && d.mismatchNoSuccess === true, 'Error/uncertain outcome evidence incomplete');
    if (id === 'MOBILE_390') {
      const screens = ['input', 'memory', 'ask', 'clarify', 'confirm', 'result', 'plans', 'privacy', 'error'];
      demand(d.viewport?.width === 390 && screens.every(screen => d.overflow?.some(m => m.screen === screen
        && Number.isFinite(m.scrollWidth) && m.scrollWidth <= m.clientWidth && m.clientWidth <= 390)), '390px overflow measurements required for every screen');
    }
    if (id === 'KEYBOARD_TARGETS_ZOOM') demand(d.keyboardFlow === true && d.focusVisible === true && d.dialogFocusRestored === true
      && d.minTargetWidth >= 44 && d.minTargetHeight >= 44 && d.zoom150 === true && d.zoom200 === true && d.zoomNoClipping === true, 'Focus/44px targets/zoom evidence incomplete');
    if (id === 'REDUCED_MOTION') demand(d.prefersReducedMotion === true && d.nonessentialMotionDisabled === true
      && d.progressStillUsable === true, 'Reduced-motion behavior not demonstrated');
    if (id === 'RAW_CAPTURE') {
      demand(d.producer === 'parent-Aside' && d.raw === true && d.mockup === false && d.linkedRunId === receipt.runId
        && d.apiMode === 'live', 'Raw visual capture must be parent Aside live-run evidence');
      demand((gate.evidence ?? []).some(ref => ['image', 'video'].includes(artifacts[ref]?.kind)), 'Raw image/video artifact required');
    }
  }
  if (receipt.runtime?.before && receipt.runtime?.after && receipt.live?.report) {
    demand(receipt.runtime.before !== receipt.runtime.after, 'Runtime before/after must be distinct captures');
    const beforeRaw = await artifact(receipt.runtime.before, 'json'), afterRaw = await artifact(receipt.runtime.after, 'json');
    const before = unwrap(beforeRaw), after = unwrap(afterRaw);
    const live = await artifact(receipt.live.report, 'json');
    demand(beforeRaw?.httpStatus === 200 && afterRaw?.httpStatus === 200 && beforeRaw?.body?.ok === true
      && afterRaw?.body?.ok === true, 'Runtime snapshots must be successful raw HTTP captures');
    demand(artifacts[receipt.live.report]?.producer === 'sj-qa', 'Live report must be independent sj-qa execution, not lead smoke evidence');
    const a = before?.sourceSnapshot, b = after?.sourceSnapshot;
    demand(typeof before?.version === 'string' && before.version === after?.version, 'Runtime version missing/changed');
    demand(a?.serverCurrent === true && b?.serverCurrent === true && validHash(a?.serverLoaded?.sha256)
      && a.serverLoaded.sha256 === a.serverOnDisk?.sha256 && a.serverLoaded.sha256 === b?.serverLoaded?.sha256
      && b.serverLoaded.sha256 === b.serverOnDisk?.sha256 && a.serverLoaded.startedAt === b.serverLoaded.startedAt
      && validHash(a?.uiOnDisk?.sha256) && a.uiOnDisk.sha256 === b?.uiOnDisk?.sha256, 'Server/UI source snapshots stale, incomplete or changed');
    demand(dateMs(beforeRaw?.capturedAt) <= dateMs(live?.startedAt) && dateMs(live?.startedAt) <= dateMs(live?.completedAt)
      && dateMs(live?.completedAt) <= dateMs(afterRaw?.capturedAt), 'Runtime snapshots must bracket the live run');
    const englishIds = receipt.live.scenarioIds ?? [];
    demand(englishIds.length > 0, 'English held-out scenario IDs missing');
    for (const id of englishIds) {
      const scenario = live?.scenarios?.find(s => s.id === id && s.lang === 'en');
      const ingest = live?.requests?.find(r => r.scenarioId === id && r.path === '/api/ingest');
      const data = unwrap(ingest?.response?.body);
      const questions = scenario?.expected ?? [];
      demand(questions.length >= 3 && questions.some(q => q.rule === 'unknown'), `${id}: three questions including unknown required`);
      demand(data?.route?.cached === false && !data?.duplicate, `${id}: fresh uncached model extraction required`);
      const calls = live?.requests?.filter(r => r.scenarioId === id) ?? [];
      demand(calls.some(c => c.path === '/api/ingest') && calls.filter(c => c.path === '/api/query').length >= 3, `${id}: ingest/query calls missing`);
      for (const call of calls) {
        const result = unwrap(call.response?.body), t = result?.telemetry, last = t?.modelCalls?.at(-1);
        const raw = t?.rawModelJson;
        const rawShape = raw != null && typeof raw === 'object' && !Array.isArray(raw)
          && (call.path === '/api/ingest' ? Array.isArray(raw.items)
            : typeof raw.found === 'boolean' && raw.slots != null && typeof raw.slots === 'object');
        demand(call.response?.httpStatus === 200 && evaluateModelEvidence(call.response?.body).status === 'PASS'
          && typeof t?.route?.cached === 'boolean' && Number.isFinite(t?.route?.ms) && t.route.ms >= 0
          && Number.isFinite(call.response?.elapsedMs) && call.response.elapsedMs >= t.route.ms
          && t.mode === result.mode && t.route.id === result.route?.id && t.route.model === result.route?.model
          && t.route.cached === result.route?.cached && t.route.ms === result.route?.ms && rawShape
          && t.validation?.ok === true && Number.isInteger(t.validation.rejected) && t.validation.rejected >= 0 && t.validation.rejected === t.rejected
          && last?.ok === true && last.route === t.route.id && last.model === t.route.model
          && last.cached === t.route.cached && last.ms === t.route.ms, `${id}/${call.questionId ?? 'ingest'}: model telemetry invalid/fallback`);
      }
      for (const question of questions) {
        const response = calls.find(c => c.questionId === question.id)?.response;
        demand(evaluateAnswer(unwrap(response?.body), question, data?.utterances ?? [], ingest?.payload?.text ?? '').status === 'PASS', `${id}/${question.id}: answer/source expectation failed`);
      }
    }
  } else pending.push('Runtime before/after and independent live report not complete');
  if (!receipt.independentReviewer || receipt.independentReviewer === receipt.preparedBy) pending.push('Independent final receipt reviewer not recorded');
  return { status: errors.length ? 'FAIL' : pending.length ? 'BLOCKED' : 'PASS', errors, pending,
    gatesPassed: gates.filter(g => g.status === 'PASS').length, gatesRequired: REQUIRED_GATES.length,
    note: 'Offline hash/structure/source checks only. Human reviewers still own visual truth and actual device claims. No new product execution performed.' };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const receipt = JSON.parse(await readFile(resolve(process.argv[2] ?? ''), 'utf8'));
    const result = await validateFinalReceipt(receipt);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.status === 'PASS' ? 0 : result.status === 'BLOCKED' ? 2 : 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
