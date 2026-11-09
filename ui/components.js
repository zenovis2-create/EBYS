// Shared UI components. All text goes through h() text nodes (no innerHTML).
import { h } from './lib/dom.js';
import { t, pick, getLang } from './i18n.js';
import { state, go, rerender } from './store.js';
import { formatWhen } from './lib/time.js';
import { speak, stopSpeaking, ttsAvailable, voiceFor } from './lib/speech.js';
import { Icon } from './lib/icons.js';

/** Visual meta per state. Only completed_external may ever say "saved". */
export const STATE_META = {
  needs_info: { icon: '?', cls: 'st-needs_info' },
  proposed: { icon: '✎', cls: 'st-proposed' },
  user_confirmed: { icon: '✓', cls: 'st-user_confirmed' },
  executing: { icon: '…', cls: 'st-executing' },
  handed_off: { icon: '↗', cls: 'st-handed_off' },
  completed_external: { icon: '✔✔', cls: 'st-completed_external' },
  simulated_completed: { icon: '≋', cls: 'st-simulated_completed' },
  user_attested: { icon: '☑', cls: 'st-user_attested' },
  failed: { icon: '⚠', cls: 'st-failed' },
  permission_denied: { icon: '⊘', cls: 'st-permission_denied' },
  unknown_outcome: { icon: '‽', cls: 'st-unknown_outcome' },
  verify_mismatch: { icon: '≠', cls: 'st-verify_mismatch' },
  cancelled: { icon: '✖', cls: 'st-cancelled' },
  expired: { icon: '⌛', cls: 'st-expired' },
  superseded: { icon: '↻', cls: 'st-superseded' },
  candidate: { icon: '○', cls: 'st-candidate' },
  user_marked_done: { icon: '☑', cls: 'st-user_attested' },
  none: { icon: '', cls: 'st-none' },
};

export function StateBadge(key) {
  const meta = STATE_META[key] ?? STATE_META.none;
  return h('span', { class: `state-badge ${meta.cls}`, 'data-state': key },
    h('span', { class: 'state-icon', 'aria-hidden': 'true' }, meta.icon), ' ', t(`st.${key}`));
}

export function UncBadge(u) {
  const key = u && ['stated', 'inferred', 'approximate', 'ambiguous', 'unknown', 'conflicting', 'superseded'].includes(u) ? u : 'unknown';
  const icon = { stated: '✔', inferred: '◐', approximate: '≈', ambiguous: '⚠', unknown: '?', conflicting: '⇄', superseded: '↻' }[key];
  return h('span', { class: `unc unc-${key}` }, h('span', { 'aria-hidden': 'true' }, icon), ' ', t(`unc.${key}`));
}

export function Btn(label, onClick, { variant = 'secondary', disabled = false, type = 'button', ariaLabel, id } = {}) {
  return h('button', { type, class: `btn btn-${variant}`, onClick, disabled, 'aria-label': ariaLabel, id }, label);
}

export function ErrorBox(error, { onDismiss } = {}) {
  if (!error) return null;
  const known = ['source_changed', 'stale_preview', 'needs_clarification', 'proposal_closed', 'not_found'].includes(error.code) ? t(`errc.${error.code}`) : null;
  const msg = error.code === 'network' ? t('err.network') : (error.userHint ? pick(error.userHint) : null) || known || error.message || '';
  return h('div', { class: 'errorbox', role: 'alert' },
    h('strong', null, '⚠ ', t('err.title')),
    h('p', { lang: error.code === 'network' || known ? undefined : langOf(msg) }, msg),
    h('p', { class: 'small' }, t('err.code', { code: error.code ?? 'unknown' }), ' · ', error.retryable ? t('err.retryable') : t('err.notRetryable')),
    onDismiss ? Btn(t('err.dismiss'), onDismiss) : null);
}

const nameOf = (x) => (x && typeof x === 'object' ? (x.name ?? x.text ?? (x.display != null ? pick(x.display) : '')) : x != null ? String(x) : '');

/**
 * Format a slot value for display; never invents anything.
 * Accepts the shapes the real core emits (object when.value with displayEn/displayKo, who as [{name}],
 * where as {name}, what as {text,title}) AND legacy plain strings.
 */
export function slotText(slot, lang = getLang()) {
  if (!slot || slot.state === 'unknown') return null;
  const v = slot.value;
  if (Array.isArray(v)) {
    const names = v.map(nameOf).filter(Boolean);
    if (names.length) return names.join(', ');
  } else if (v && typeof v === 'object') {
    if (v.displayEn != null || v.displayKo != null) {
      const s = lang === 'ko' ? (v.displayKo ?? v.displayEn) : (v.displayEn ?? v.displayKo);
      if (s) return s;
    }
    if (v.title && typeof v.title === 'object') return v.title[lang] ?? v.title.en ?? v.title.ko ?? v.text ?? null;
    const s = nameOf(v);
    if (s) return s;
    if (v.date) return formatWhen(v.startIso ?? v.date, lang) ?? v.date;
  }
  if (slot.display != null && typeof slot.display === 'object') return pick(slot.display) || null;
  if (slot.display) return slot.display;
  if (typeof v === 'string') return formatWhen(v, lang) ?? v;
  return null;
}

/** Language attribute for a piece of user/model text (Korean quotes stay Korean inside an English screen). */
export const langOf = (s) => (/[\u3131-\u318E\uAC00-\uD7A3]/.test(String(s ?? '')) ? 'ko' : 'en');

/** Timezone note: Seoul time stated explicitly; device zone shown; mismatch flagged. Never converts silently. */
export function deviceTimeZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { return null; }
}
export function TzNote({ compact = false } = {}) {
  const dev = deviceTimeZone();
  const differs = dev && dev !== 'Asia/Seoul';
  return h('div', { class: `tznote ${differs ? 'tz-differs' : ''}`, role: 'note' },
    Icon('clock', { size: 24 }), h('span', null, compact ? t('tz.seoul') : t('tz.note')),
    dev && !compact ? h('span', { class: 'small tz-dev' }, ' ', t('tz.device', { tz: dev }), differs ? ` · ${t('tz.differs')}` : '') : null);
}

export function SlotBox(labelKey, slot, { showEvidence = true } = {}) {
  const text = slotText(slot);
  const evs = slot?.evidence ?? [];
  const body = text
    ? h('div', { class: 'slot-value' }, text)
    : h('div', { class: 'slot-value slot-unknown' }, t('slot.unknown'), h('div', { class: 'small' }, t('slot.unknownHint')));
  const icon = { 'slot.who': 'person', 'slot.when': 'clock', 'slot.where': 'pin', 'slot.what': 'note' }[labelKey];
  return h('div', { class: `slot ${text ? '' : 'slot-empty'}` },
    h('div', { class: 'slot-label' }, icon ? Icon(icon, { size: 24 }) : null, h('span', null, t(labelKey))),
    text ? h('div', { class: 'slot-value', lang: langOf(text) }, text) : body,
    text ? h('div', { class: 'slot-meta' }, UncBadge(slot.uncertainty)) : null,
    slot?.clarification ? h('p', { class: 'small' }, pick(slot.clarification)) : null,
    showEvidence && text
      ? (evs.length
        ? Btn([Icon('quote', { size: 22 }), ' ', t('a3.slotEvidence', { n: evs.length })], () => openEvidence(evs), { variant: 'link' })
        : h('p', { class: 'small warn' }, t('a2.noEvidence')))
      : null);
}

/** Evidence drawer: verbatim quote, speaker, highlighted position, and a client-side verbatim re-check. */
export function openEvidence(evs) {
  const dlg = document.getElementById('evidence-dialog');
  dlg.replaceChildren();
  const items = (evs ?? []).map((e) => {
    const u = state.utterances.get(e.utteranceId);
    const text = u?.text ?? null;
    const verified = text ? text.includes(e.quote) : false;
    let start = text && text.slice(e.charStart, e.charEnd) === e.quote ? e.charStart : (text ? text.indexOf(e.quote) : -1);
    const line = text && start >= 0
      ? h('p', { class: 'ev-line' }, text.slice(0, start), h('mark', null, text.slice(start, start + e.quote.length)), text.slice(start + e.quote.length))
      : h('p', { class: 'small' }, t('ev.unknownSource'));
    return h('li', { class: 'ev-item' },
      u ? h('div', { class: 'ev-speaker' }, Icon('person', { size: 24 }), h('span', null, t('ev.speaker'), ': ', u.speakerKnown === false ? t('a2.unknownSpeaker') : u.speakerLabel)) : null,
      h('blockquote', { class: 'ev-quote', lang: langOf(e.quote) }, e.quote),
      h('div', { lang: langOf(text ?? e.quote) }, line),
      h('div', { class: verified ? 'ev-ok' : 'ev-bad' }, verified ? Icon('check', { size: 24 }) : null, h('span', null, verified ? t('ev.verbatimOk') : t('ev.verbatimBad'))),
      u ? Btn(t('ev.open'), () => {
        dlg.close();
        state.openTranscript = true; state.highlightUtterance = e.utteranceId;
        go('memories');
      }, { variant: 'link' }) : null);
  });
  dlg.append(h('h2', null, t('ev.title')),
    items.length ? h('ul', { class: 'ev-list' }, items) : h('p', { class: 'warn' }, t('ev.none')),
    Btn(t('ev.close'), () => dlg.close(), { variant: 'primary' }));
  if (!dlg.open) dlg.showModal();
}

/** Read-aloud button for a piece of text that is ALWAYS also shown on screen. */
export function ReadAloud(id, getText) {
  const lang = getLang();
  if (!ttsAvailable()) return h('p', { class: 'small' }, t('voice.unavailable'));
  const speaking = state.speaking === id;
  return h('div', { class: 'readaloud' },
    Btn(speaking ? t('voice.stop') : t('voice.read'), () => {
      if (state.speaking === id) { stopSpeaking(); state.speaking = null; return rerender(); }
      state.speaking = id;
      speak(getText(), lang, { onend: () => { if (state.speaking === id) { state.speaking = null; rerender(); } } });
      return rerender();
    }),
    h('p', { class: 'small' }, t('voice.note'), voiceFor(lang) === 'no' ? ` ${t(lang === 'en' ? 'voice.novoiceEn' : 'voice.novoice')}` : ''));
}

/** Auto read-aloud when the user turned the preference on (in memory only). */
export function autoSpeak(id, text) {
  if (!state.voiceOn || !text) return;
  state.speaking = id;
  speak(text, getLang(), { onend: () => { if (state.speaking === id) { state.speaking = null; } } });
}

/** Chip showing which route produced the last model-backed result. */
export function modelChipInfo() {
  const rt = state.runtime?.model;
  const last = state.lastModel;
  if (last?.mode === 'fallback') return { cls: 'chip-fallback', text: t('chip.model.fallback') };
  if (last?.mode === 'fixture' || (!last && rt?.route === 'fixture')) return { cls: 'chip-fixture', text: t('chip.model.fixture') };
  if (last?.mode === 'model') {
    const r = last.route ?? {};
    return r.cached
      ? { cls: 'chip-model', text: t('chip.model.cached', { route: r.id ?? '?' }) }
      : { cls: 'chip-model', text: t('chip.model.live', { route: r.id ?? '?', model: r.model ?? '?' }) };
  }
  if (!rt) return { cls: 'chip-unverified', text: t('chip.model.unverified') };
  if (rt.route === 'fallback-rules' || rt.healthy === false) {
    return { cls: 'chip-fallback', text: rt.lastError ? `${t('chip.model.fallback')} (${rt.lastError})` : t('chip.model.fallback') };
  }
  if (rt.healthy === true) return { cls: 'chip-model', text: t('chip.model.live', { route: rt.route, model: rt.model }) };
  return { cls: 'chip-unverified', text: `${t('chip.model.unverified')}: ${rt.route ?? '?'}` };
}

export { rerender };
