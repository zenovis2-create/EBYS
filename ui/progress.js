// Calm progress state for slow model calls (10-40 s). Never fakes an answer; user can cancel.
import { h } from './lib/dom.js';
import { t } from './i18n.js';

let active = null;

/** fn receives an AbortSignal and returns an api result. Resolves to the result, or a 'cancelled' error. */
export async function runWithProgress(labelKey, fn) {
  if (active) return { ok: false, error: { code: 'busy', message: 'another request is running', retryable: true } };
  const ctl = new AbortController();
  const started = Date.now();
  const elapsed = h('span', { class: 'prog-elapsed' }, t('prog.elapsed', { s: 0 }));
  const calm = h('p', { class: 'prog-calm' }, t('prog.calm'));
  const cancelBtn = h('button', {
    type: 'button', class: 'btn btn-secondary', onClick: () => ctl.abort(new Error('cancelled')),
  }, t('prog.cancel'));
  const box = h('div', { class: 'overlay', role: 'status', 'aria-live': 'polite' },
    h('div', { class: 'overlay-card', tabindex: '-1' },
      h('div', { class: 'spinner', 'aria-hidden': 'true' }),
      h('p', { class: 'prog-title' }, t(labelKey)),
      calm, elapsed, cancelBtn));
  document.body.append(box);
  document.body.setAttribute('aria-busy', 'true');
  box.querySelector('.overlay-card').focus();
  const timer = setInterval(() => {
    const s = Math.floor((Date.now() - started) / 1000);
    elapsed.textContent = t('prog.elapsed', { s });
    if (s >= 30) calm.textContent = t('prog.long');
  }, 1000);
  active = box;
  try {
    const res = await fn(ctl.signal);
    return res;
  } catch (e) {
    if (ctl.signal.aborted) return { ok: false, error: { code: 'cancelled', message: t('prog.cancelled'), retryable: true } };
    return { ok: false, error: { code: 'ui_error', message: String(e?.message ?? e), retryable: true } };
  } finally {
    clearInterval(timer);
    box.remove();
    document.body.removeAttribute('aria-busy');
    active = null;
  }
}
