// A1 Home: add a conversation (consent first; sample or your own text)
import { h } from '../lib/dom.js';
import { t } from '../i18n.js';
import { state, app, go, rerender, noteSession } from '../store.js';
import { Btn, ErrorBox, langOf } from '../components.js';
import { runWithProgress } from '../progress.js';
import { SAMPLES } from '../samples.js';
import { Icon, BrandMark } from '../lib/icons.js';

export async function loadMemories() {
  const r = await app.api.memories();
  if (r.ok) state.memories = Array.isArray(r.data) ? r.data : [];
  return r;
}

async function analyze() {
  state.inputError = null;
  if (state.paused) { state.inputError = { code: 'paused', message: t('a1.pausedBlock'), retryable: true }; return rerender(); }
  if (state.text.trim().length < 5) { state.inputError = { code: 'empty', message: t('a1.needText'), retryable: true }; return rerender(); }
  if (!state.consent) {
    state.inputError = { code: 'no_consent', message: t('a1.needConsent'), retryable: true };
    rerender();
    return document.getElementById('consent')?.focus();
  }
  // No `lang` is sent: the conversation's language is independent of the UI language.
  const res = await runWithProgress('prog.ingest', (signal) => app.api.ingest(
    { title: state.title || undefined, text: state.text, provenance: state.provenance }, { signal }));
  if (!res.ok) {
    state.inputError = res.error;
    return rerender();
  }
  const d = res.data;
  noteSession({ sessionId: d.sessionId, title: state.title || d.title || '', utterances: d.utterances ?? [] });
  state.lastIngest = { mode: d.mode, route: d.route, memoriesCreated: d.memoriesCreated ?? 0, rejected: d.rejected ?? 0, note: d.note };
  state.lastModel = { mode: d.mode, route: d.route };
  const mem = await loadMemories();
  if (!mem.ok) state.inputError = mem.error;
  state.answer = null;
  go('memories');
}

function modeKey(mode) {
  return mode === 'fallback' ? 'a1.lastMode.fallback' : mode === 'fixture' ? 'a1.lastMode.fixture' : 'a1.lastMode.model';
}

const SAMPLE_LIST = [['sample1', 'a1.sample1'], ['sample2', 'a1.sample2'], ['sample3', 'a1.sample3']];

function Hero() {
  const stage = state.memories.length ? (state.plans.size ? 3 : 2) : 1;
  return h('div', { class: 'hero' },
    h('p', { class: 'eyebrow' }, t('app.tagline')),
    h('div', { class: 'hero-top' }, BrandMark({ size: 64, cls: 'hero-mark' }),
      h('h1', { id: 'screen-title', tabindex: '-1', class: 'hero-title' }, t('home.hello'))),
    h('p', { class: 'hero-lead' }, t('home.lead')),
    h('ol', { class: 'path', 'aria-label': t('a1.title') },
      ['home.step1', 'home.step2', 'home.step3'].map((k, i) => h('li', { class: i + 1 < stage ? 'path-done' : i + 1 === stage ? 'path-now' : '', 'aria-current': i + 1 === stage ? 'step' : null },
        h('span', { class: 'path-n', 'aria-hidden': 'true' }, i + 1 < stage ? '✓' : String(i + 1)), h('span', null, t(k))))));
}

export function renderInput() {
  const textarea = h('textarea', {
    id: 'conv-text', rows: '7', class: 'field', 'aria-describedby': 'conv-hint', spellcheck: 'false', lang: state.text ? langOf(state.text) : null,
    onInput: (e) => { state.text = e.target.value; },
  }, state.text);
  const titleInput = h('input', {
    id: 'conv-title', type: 'text', class: 'field', value: state.title, onInput: (e) => { state.title = e.target.value; },
  });
  const pickSample = (key) => {
    const s = SAMPLES[key];
    state.text = s.text; state.title = s.title; state.consent = false; state.provenance = 'synthetic'; state.sampleKey = key;
    rerender();
    queueMicrotask(() => document.getElementById('consent')?.scrollIntoView({ block: 'center' }));
  };
  const last = state.lastIngest;
  return h('section', { 'aria-labelledby': 'screen-title' },
    Hero(),
    last ? h('div', { class: 'card card-quiet' },
      h('p', { class: last.mode === 'fallback' || last.mode === 'fixture' ? 'warn-strong' : 'ok-strong' }, t(modeKey(last.mode))),
      h('p', null, t('a1.lastMem', { n: last.memoriesCreated })),
      last.rejected ? h('p', { class: 'warn' }, t('a1.lastRej', { n: last.rejected })) : null,
      state.memories.length ? Btn(t('home.next'), () => go('memories'), { variant: 'secondary' }) : null) : null,
    h('h2', null, t('home.samples')),
    app.apiKind === 'fixture' ? h('p', { class: 'note note-fixture' }, t('a1.fixtureNoText')) : null,
    h('div', { class: 'samples' }, SAMPLE_LIST.map(([key, label]) => h('button', {
      type: 'button', class: `samplecard ${state.sampleKey === key && state.text === SAMPLES[key].text ? 'samplecard-on' : ''}`,
      'aria-pressed': String(state.sampleKey === key && state.text === SAMPLES[key].text), onClick: () => pickSample(key),
    }, Icon('note', { size: 28 }), h('span', { class: 'sc-words' }, h('span', { class: 'sc-title' }, t(label)), h('span', { class: 'sc-tag' }, t('home.sampleTag')))))),
    h('h2', null, t('home.own')),
    h('label', { for: 'conv-text', class: 'label' }, t('a1.textLabel')), textarea,
    h('p', { id: 'conv-hint', class: 'small' }, t('a1.textHint')),
    h('details', { class: 'more' },
      h('summary', null, t('home.more')),
      h('label', { for: 'conv-title', class: 'label' }, t('a1.titleLabel')), titleInput,
      h('fieldset', { class: 'choices' },
        h('legend', null, t('a1.provLabel')),
        radio('prov', 'synthetic', t('a1.provSynthetic'), state.provenance === 'synthetic', () => { state.provenance = 'synthetic'; rerender(); }),
        radio('prov', 'consented', t('a1.provConsented'), state.provenance === 'consented', () => { state.provenance = 'consented'; rerender(); }))),
    h('div', { class: 'actionzone' },
      state.title && state.text ? h('p', { class: 'small' }, t('home.ready', { title: state.title })) : null,
      h('label', { class: 'check check-strong' },
        h('input', { id: 'consent', type: 'checkbox', checked: state.consent, onChange: (e) => { state.consent = e.target.checked; } }),
        h('span', null, t('a1.consent'))),
      ErrorBox(state.inputError, { onDismiss: () => { state.inputError = null; rerender(); } }),
      state.paused ? h('p', { class: 'note' }, t('a1.pausedBlock')) : null,
      Btn(t('a1.analyze'), analyze, { variant: 'primary', disabled: state.paused }),
      state.text ? Btn(t('a1.clear'), () => { state.text = ''; state.title = ''; state.consent = false; state.sampleKey = null; rerender(); }, { variant: 'link' }) : null));
}

function radio(name, value, label, checked, onChange) {
  return h('label', { class: 'check' },
    h('input', { type: 'radio', name, value, checked, onChange }), h('span', null, label));
}
