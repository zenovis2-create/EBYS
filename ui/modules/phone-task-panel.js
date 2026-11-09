// Phone task panel (NEW module, standalone): preview -> explicit confirm -> status -> verified result for a task that
// runs on the user's phone through the existing Jarvis bridge (adapters/phone-exec.mjs). Contract: phone-use/CONTRACT.md.
//
// Truth rules (the panel only DISPLAYS what the backend reports; it never decides a task succeeded):
//  * Nothing is sent until the user presses the confirm button on the exact preview.
//  * "Sent / queued" is never shown as done. Success needs status === 'completed' AND verifyLevel === 'device_readback'
//    (an independent phone-screen readback made by the backend). Anything else is shown as not confirmed.
//  * Backend errors, 401s and network failures are shown as errors, never swallowed or turned into success.
// SECURITY: text is only added as text nodes (lib/dom.js). No token, credential or bridge address lives here:
// the browser only talks to the EBYS server (same origin); the server holds the bridge authorization.
import { h, clear } from '../lib/dom.js';

export { createHttpPhoneTransport, DEFAULT_PHONE_PATHS as DEFAULT_PATHS } from '../services/liveApi.js';

const isErr = (r) => !r || typeof r !== 'object' || r.ok === false;
const errOf = (r, fallback) => (r && r.error) || { code: 'bad_response', message: fallback, userHint: { en: 'Something went wrong. Please try again.' } };
const TERMINAL = new Set(['completed', 'failed', 'verify_mismatch', 'unknown_outcome']);


const STYLE_ID = 'sjphone-style';
const CSS = `
.sjphone{font-family:var(--font-body,system-ui,sans-serif);color:var(--text,#10282c);font-size:calc(1.125rem * var(--scale,1));line-height:1.4;max-width:100%;box-sizing:border-box;padding:0 0 1.25rem}
.sjphone *,.sjphone *::before,.sjphone *::after{box-sizing:border-box}
.sjphone h1,.sjphone h2,.sjphone p,.sjphone ul{margin:0;padding:0}
.sjphone ul{list-style:none}
.sjphone-h1{font-family:var(--font-display,Georgia,serif);font-size:1.5em;margin-bottom:.5rem}
.sjphone-h1:focus{outline:none}
.sjphone-card{background:var(--paper,#fffdf6);border:2px solid var(--rule,#cfe0e6);border-radius:var(--radius,18px);padding:1rem;margin:.75rem 0}
.sjphone-card.ok{border-color:var(--primary,#0b4f55)}
.sjphone-card.bad{border-color:var(--danger,#8a1c1c)}
.sjphone-label{font-size:.8em;font-weight:700;color:var(--muted,#2e4649);margin-top:.6rem}
.sjphone-exact{white-space:pre-wrap;word-break:break-word;background:var(--sand,#fbefd2);border-radius:12px;padding:.6rem .8rem;font-size:.95em}
.sjphone-list{padding-left:1.1rem;list-style:disc!important}
.sjphone-actions{display:flex;flex-wrap:wrap;gap:.6rem;margin-top:.9rem}
.sjphone-btn{min-height:3.5rem;min-width:3.5rem;padding:.4rem 1rem;font:inherit;font-weight:700;color:var(--primary,#0b4f55);background:var(--paper,#fffdf6);border:2px solid var(--primary,#0b4f55);border-radius:var(--radius,18px);cursor:pointer}
.sjphone-btn.primary{color:var(--primary-fg,#fff8e8);background:var(--primary,#0b4f55)}
.sjphone-btn:disabled{opacity:.55;cursor:default}
.sjphone-btn:focus-visible{outline:3px solid var(--focus,#c2410c);outline-offset:2px}
.sjphone-error{color:var(--danger,#8a1c1c);font-weight:700}
.sjphone-fine{font-size:.85em;color:var(--muted,#2e4649)}
`;
function ensureStyle() {
  const d = globalThis.document;
  if (!d?.head || !d.createElement) return;
  if (d.getElementById?.(STYLE_ID)) return;
  const el = d.createElement('style');
  el.setAttribute('id', STYLE_ID);
  el.append(CSS);
  d.head.append(el);
}

/**
 * @param {{
 *   transport: { preview(task), confirm({task, previewDigest}), readback(recordId) },  // see createHttpPhoneTransport
 *   task?: { taskId: string, revision: number, kind: string },   // chosen by the host/agent path; or call panel.setTask(task)
 *   lang?: 'en'|'ko',                       // picks the backend {en,ko} text; panel chrome is English
 *   pollMs?: number, maxPollMs?: number,    // status polling (defaults 2000 / 120000)
 *   onPhase?: (info: {phase, task, preview, record, error}) => void,   // every state change (for host analytics/layout)
 *   onResult?: (record) => void,            // once, when the backend reports a terminal status (see CONTRACT.md)
 *   onCancel?: () => void,                  // user declined at the preview; nothing was sent
 *   setTimer?: Function, clearTimer?: Function  // test hooks
 * }} opts
 * @returns {HTMLElement} root; also .setTask(task), .getState(), .destroy()
 */
export function renderPhoneTaskPanel({ transport, task = null, lang = 'en', pollMs = 2000, maxPollMs = 120000, onPhase, onResult, onCancel,
  setTimer = (f, ms) => setTimeout(f, ms), clearTimer = (t) => clearTimeout(t), now = Date.now } = {}) {
  if (!transport?.preview || !transport?.confirm || !transport?.readback) throw new TypeError('transport.preview/confirm/readback are required');
  ensureStyle();
  // phase: idle | previewing | review | confirming | executing | done | error
  const st = { phase: 'idle', task: null, preview: null, record: null, error: null, notice: null, lastConfirmUnknown: false, pollStartedAt: 0, pollTimer: null, gen: 0, destroyed: false, resultFired: false };
  const root = h('section', { class: 'sjphone', 'aria-label': 'Phone task' });
  const live = h('p', { class: 'sjphone-fine', role: 'status', 'aria-live': 'polite' });
  const pick = (v) => (v == null ? '' : typeof v === 'string' ? v : v[lang] ?? v.en ?? '');
  const pickList = (v) => (Array.isArray(v) ? v : v?.[lang] ?? v?.en ?? []);
  const btn = (label, onClick, { primary = false, disabled = false } = {}) => h('button', { type: 'button', class: `sjphone-btn${primary ? ' primary' : ''}`, onclick: onClick, disabled }, label);
  let heading = null;

  function emit() { onPhase?.({ phase: st.phase, task: st.task, preview: st.preview, record: st.record, error: st.error }); }
  function setPhase(phase, msg) { st.phase = phase; if (msg) live.textContent = msg; draw(); emit(); }
  function stopPoll() { if (st.pollTimer != null) { clearTimer(st.pollTimer); st.pollTimer = null; } }

  async function startPreview(t) {
    stopPoll();
    const gen = ++st.gen;
    st.task = t; st.preview = null; st.record = null; st.error = null; st.lastConfirmUnknown = false;
    if (!t) { setPhase('idle'); return; }
    setPhase('previewing', 'Checking what this task will do…');
    let r;
    try { r = await transport.preview(t); } catch (e) { r = { ok: false, error: { code: 'network', message: String(e?.message ?? e), userHint: { en: "Couldn't reach EBYS." } } }; }
    if (gen !== st.gen || st.destroyed) return;
    if (isErr(r)) { st.error = errOf(r, 'preview failed'); setPhase('error', 'This task cannot be shown.'); return; }
    if (r.needs_clarification) { st.error = { code: 'needs_clarification', message: 'needs clarification', userHint: r.question ?? { en: 'More details are needed before this can run.' } }; setPhase('error', 'More details are needed.'); return; }
    if (typeof r.previewDigest !== 'string' || !r.previewDigest || typeof r.exactPrompt !== 'string') { st.error = { code: 'bad_preview', message: 'preview missing previewDigest/exactPrompt', userHint: { en: 'EBYS could not show exactly what would be sent, so nothing can be sent.' } }; setPhase('error', 'Cannot show this task safely.'); return; }
    st.preview = r;
    setPhase('review', 'Please check the task, then choose.');
  }

  async function confirm() {
    if (st.phase !== 'review' && !(st.phase === 'error' && st.lastConfirmUnknown)) return; // double-tap / wrong-state guard
    if (!st.preview) return;
    const gen = ++st.gen;
    st.error = null; st.notice = null;
    setPhase('confirming', 'Sending to your phone…');
    let r;
    try { r = await transport.confirm({ task: st.task, previewDigest: st.preview.previewDigest }); } catch (e) { r = { ok: false, error: { code: 'network', message: String(e?.message ?? e) } }; }
    if (gen !== st.gen || st.destroyed) return;
    if (isErr(r)) {
      const e = errOf(r, 'confirm failed');
      if (e.code === 'stale_preview') { st.notice = pick(e.userHint) || 'Something changed. Please review again.'; await startPreview(st.task); return; }
      // network/unknown phase: the request may have reached the server. Retrying is safe (the backend queues one job per task/revision).
      st.lastConfirmUnknown = e.code === 'network' || e.phase === 'unknown';
      st.error = st.lastConfirmUnknown ? { ...e, userHint: { en: "We couldn't confirm whether this was sent. Check your phone. Pressing Try again will not send it twice." } } : e;
      setPhase('error', 'The task was not confirmed.');
      return;
    }
    acceptRecord(r);
  }

  function acceptRecord(rec) {
    st.record = rec;
    if (TERMINAL.has(rec.status)) { finish(); return; }
    if (rec.status === 'executing' || rec.status === 'confirmed') {
      if (!st.pollStartedAt || st.phase !== 'executing') st.pollStartedAt = now();
      setPhase('executing', pick(rec.readbackText) || 'Sent to your phone. Not confirmed yet.');
      schedulePoll();
      return;
    }
    st.error = { code: 'unknown_status', message: `unexpected status ${rec.status}`, userHint: { en: 'EBYS returned a status we do not recognise. Please check your phone.' } };
    setPhase('error', 'Status unclear.');
  }

  function schedulePoll() {
    stopPoll();
    if (st.destroyed) return;
    const gen = st.gen;
    st.pollTimer = setTimer(async () => {
      st.pollTimer = null;
      if (gen !== st.gen || st.destroyed || !st.record?.recordId) return;
      let r;
      try { r = await transport.readback(st.record.recordId); } catch (e) { r = { ok: false, error: { code: 'network', message: String(e?.message ?? e) } }; }
      if (gen !== st.gen || st.destroyed) return;
      if (isErr(r)) {
        st.notice = 'Could not check your phone just now. Still trying.';
      } else {
        st.notice = null; st.record = r;
        if (TERMINAL.has(r.status)) { finish(); return; }
      }
      if (now() - st.pollStartedAt > maxPollMs) { st.notice = 'Still not confirmed. Check your phone yourself, or check again.'; setPhase('executing', st.notice); return; }
      setPhase('executing', pick(st.record?.readbackText) || 'Waiting for your phone.');
      schedulePoll();
    }, pollMs);
  }

  function finish() {
    stopPoll();
    setPhase('done', pick(st.record.readbackText) || `Status: ${st.record.status}`);
    if (!st.resultFired) { st.resultFired = true; try { onResult?.(st.record); } catch { /* host callback must not break the panel */ } }
  }

  function checkAgain() { if (st.record?.recordId) { st.pollStartedAt = now(); schedulePoll(); setPhase('executing', 'Checking your phone…'); } }
  function decline() { stopPoll(); st.gen++; st.preview = null; setPhase('idle', 'Cancelled. Nothing was sent to your phone.'); onCancel?.(); }

  // ---------- views ----------
  const fact = (label, value) => (value ? [h('p', { class: 'sjphone-label' }, label), h('p', {}, value)] : []);

  function reviewView() {
    const p = st.preview;
    const willNot = pickList(p.willNot);
    return [
      h('h2', { class: 'sjphone-h1', tabindex: '-1' }, 'Check before it goes to your phone'),
      st.notice ? h('p', { class: 'sjphone-error', role: 'alert' }, st.notice) : null,
      h('div', { class: 'sjphone-card' },
        ...fact('Task', pick(p.display?.task) || pick(p.summary)),
        ...fact('Phone', pick(p.display?.device)),
        ...fact('Risk', pick(p.display?.risk)),
        h('p', { class: 'sjphone-label' }, 'Exactly what will be sent'),
        h('p', { class: 'sjphone-exact', 'data-testid': 'exact' }, p.exactPrompt),
        willNot.length ? [h('p', { class: 'sjphone-label' }, 'It will not'), h('ul', { class: 'sjphone-list' }, willNot.map((w) => h('li', {}, w)))] : null,
        ...fact('How', pick(p.modeLabel)),
        ...fact('Permission', p.permission ? `${p.permission} (asks before anything sensitive)` : '')),
      (p.warnings ?? []).length ? h('p', { class: 'sjphone-error' }, p.warnings.map(pick).join(' ')) : null,
      h('div', { class: 'sjphone-actions' },
        btn('Send to my phone', confirm, { primary: true }),
        btn('Cancel', decline)),
    ];
  }

  function recordFacts() {
    const r = st.record;
    const rb = r?.readback;
    return [
      rb?.package ? h('p', { class: 'sjphone-fine' }, `Phone screen showed: ${rb.package}${rb.checkedAt ? ` at ${rb.checkedAt}` : ''}`) : null,
      r?.deduplicated ? h('p', { class: 'sjphone-fine' }, 'This task had already been sent. Showing its status, not sending again.') : null,
      r?.error?.userHint ? h('p', { class: 'sjphone-error' }, pick(r.error.userHint)) : null,
    ];
  }

  function executingView() {
    return [
      h('h2', { class: 'sjphone-h1', tabindex: '-1' }, st.phase === 'confirming' ? 'Sending…' : 'Sent. Not confirmed yet'),
      h('div', { class: 'sjphone-card' },
        h('p', {}, pick(st.record?.readbackText) || 'Waiting for your phone.'),
        h('p', { class: 'sjphone-fine' }, 'Being sent is not the same as done. EBYS will say it worked only after it checks your phone screen.'),
        st.notice ? h('p', { class: 'sjphone-error' }, st.notice) : null,
        ...recordFacts()),
      st.phase === 'executing' ? h('div', { class: 'sjphone-actions' }, btn('Check again', checkAgain)) : null,
    ];
  }

  function doneView() {
    const r = st.record;
    const verified = r.status === 'completed' && r.verifyLevel === 'device_readback';
    const title = verified ? 'Done. Checked on your phone'
      : r.status === 'completed' ? 'Reported done, but not checked'
      : r.status === 'verify_mismatch' ? 'Your phone shows something else'
      : r.status === 'unknown_outcome' ? "We can't tell if it worked"
      : "That didn't finish";
    return [
      h('h2', { class: 'sjphone-h1', tabindex: '-1' }, title),
      h('div', { class: `sjphone-card ${verified ? 'ok' : 'bad'}` },
        h('p', {}, pick(r.readbackText) || `Status: ${r.status}`),
        r.status === 'completed' && !verified ? h('p', { class: 'sjphone-error' }, 'The phone screen was not independently checked, so do not rely on this. Please look at your phone.') : null,
        ...recordFacts()),
      h('div', { class: 'sjphone-actions' }, btn('Close', () => { st.record = null; st.preview = null; st.task = null; setPhase('idle', ''); })),
    ];
  }

  function errorView() {
    const e = st.error;
    return [
      h('h2', { class: 'sjphone-h1', tabindex: '-1' }, st.lastConfirmUnknown ? 'Not sure it was sent' : "This can't run"),
      h('div', { class: 'sjphone-card bad' },
        h('p', { class: 'sjphone-error', role: 'alert' }, pick(e?.userHint) || e?.message || 'Something went wrong.'),
        e?.code ? h('p', { class: 'sjphone-fine' }, `Code: ${e.code}`) : null),
      h('div', { class: 'sjphone-actions' },
        st.lastConfirmUnknown ? btn('Try again', confirm, { primary: true }) : (st.task ? btn('Check again', () => startPreview(st.task)) : null),
        btn('Close', () => { st.error = null; st.lastConfirmUnknown = false; setPhase('idle', ''); })),
    ];
  }

  function draw() {
    clear(root);
    let body;
    switch (st.phase) {
      case 'previewing': body = [h('h2', { class: 'sjphone-h1', tabindex: '-1' }, 'Checking…'), h('p', {}, 'Working out exactly what this would do.')]; break;
      case 'review': body = reviewView(); break;
      case 'confirming': case 'executing': body = executingView(); break;
      case 'done': body = doneView(); break;
      case 'error': body = errorView(); break;
      default: body = [];
    }
    root.append(...body.flat(Infinity).filter(Boolean), live);
    heading = body.flat(Infinity).find((n) => n?.tag === 'h2' || n?.tagName === 'H2') ?? null;
    if (st.phase !== 'idle') heading?.focus?.();
  }

  root.setTask = (t) => startPreview(t);
  root.getState = () => ({ phase: st.phase, task: st.task, preview: st.preview, record: st.record, error: st.error });
  root.destroy = () => { st.destroyed = true; st.gen++; stopPoll(); };
  draw();
  if (task) startPreview(task);
  return root;
}
