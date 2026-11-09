// A3 Ask (free-form) with answer slots + evidence
import { h } from '../lib/dom.js';
import { t, pick, getLang } from '../i18n.js';
import { state, app, go, rerender } from '../store.js';
import { Btn, ErrorBox, SlotBox, ReadAloud, autoSpeak } from '../components.js';
import { recognitionCtor, startListening, stopListening } from '../lib/speech.js';
import { runWithProgress } from '../progress.js';
import { openProposal, startProposal } from './memories.js';

export async function ask(text) {
  state.question = text;
  state.askError = null;
  if (!text.trim()) return rerender();
  const res = await runWithProgress('prog.query', (signal) => app.api.query({ text, lang: getLang() }, { signal }));
  if (!res.ok) { state.askError = res.error; state.answer = null; return rerender(); }
  state.answer = res.data;
  if (res.data.mode) state.lastModel = { mode: res.data.mode, route: res.data.route ?? state.lastModel?.route };
  autoSpeak('answer', answerSpeech(res.data));
  rerender();
}

/** Text read aloud for an answer: the sentence plus what is unknown (the same words are shown on screen). */
export function answerSpeech(a) {
  const head = a.found === false ? t('a3.notFound') : pick(a.sentence);
  const unknown = ['who', 'when', 'where', 'what']
    .filter((k) => !a.slots?.[k] || a.slots[k].state === 'unknown')
    .map((k) => `${t(`slot.${k}`)}: ${t('slot.unknown')}`);
  return [head, ...unknown].filter(Boolean).join('. ');
}

function toggleMic() {
  state.micError = null;
  if (state.listening) { stopListening(); return; }
  if (state.paused) { state.micError = t('mic.pausedBlock'); return rerender(); }
  state.listening = true;
  const started = startListening(getLang(), {
    onText: (txt) => { state.question = txt; }, // never auto-sent: the user reviews and presses Ask
    onEnd: () => { state.listening = false; rerender(); },
    onError: (e) => { state.micError = t('mic.error', { e }); },
  });
  if (!started) state.listening = false;
  rerender();
}

function modeNote(a) {
  if (a.mode === 'fallback') return h('p', { class: 'note note-fixture' }, t('a3.modeFallback'));
  if (a.mode === 'fixture') return h('p', { class: 'note note-fixture' }, t('a3.modeFixture'));
  if (a.mode === 'model') return h('p', { class: 'small' }, t('a3.modeModel', { route: a.route?.id ?? state.lastModel?.route?.id ?? '?' }));
  return null;
}

function AnswerCard(a) {
  const sl = a.slots ?? {};
  return h('div', { class: 'card answer', 'aria-live': 'polite' },
    h('h2', null, t('a3.answer')),
    modeNote(a),
    a.found === false
      ? h('div', null,
        h('p', { class: 'answer-sentence' }, pick(a.sentence) || t('a3.notFound')),
        h('p', { class: 'warn-strong' }, t('a3.notFound')),
        a.notFoundReason ? h('p', { class: 'small' }, a.notFoundReason) : null)
      : h('p', { class: 'answer-sentence' }, pick(a.sentence)),
    h('div', { class: 'slots' },
      SlotBox('slot.who', sl.who), SlotBox('slot.when', sl.when), SlotBox('slot.where', sl.where), SlotBox('slot.what', sl.what)),
    (a.caveats ?? []).length ? h('div', { class: 'caveats' }, h('p', { class: 'label' }, t('a3.caveats')),
      h('ul', null, a.caveats.map((c) => h('li', null, t(`caveat.${c}`) === `caveat.${c}` ? c : t(`caveat.${c}`))))) : null,
    a.clarification ? h('div', { class: 'note' }, h('strong', null, t('a3.clarify'), ': '), pick(a.clarification.prompt),
      (a.clarification.options ?? []).length ? h('div', null, h('p', { class: 'small' }, t('a3.options')),
        h('ul', null, a.clarification.options.map((o) => h('li', null, getLang() === 'ko' ? (o.label ?? o.labelEn) : (o.labelEn ?? o.label)))))
        : null) : null,
    ReadAloud('answer', () => answerSpeech(a)),
    h('div', { class: 'stack' },
      a.proposal ? Btn(t('a3.makeProposal'), () => openProposal(a.proposal), { variant: 'primary' })
        : a.found && a.memoryId ? Btn(t('a3.makeProposal'), () => startProposal(a.memoryId), { variant: 'primary' }) : null,
      Btn(t('a3.again'), () => { state.answer = null; state.question = ''; rerender(); })));
}

export function renderAsk() {
  const input = h('input', {
    id: 'q', type: 'text', class: 'field', value: state.question, placeholder: t('a3.placeholder'), enterkeyhint: 'send',
    onInput: (e) => { state.question = e.target.value; },
    onKeydown: (e) => { if (e.key === 'Enter') ask(state.question); },
  });
  return h('section', { 'aria-labelledby': 'screen-title' },
    h('h1', { id: 'screen-title', tabindex: '-1' }, t('a3.title')),
    state.memories.length ? null : h('div', { class: 'card' }, h('p', null, t('a3.noMemory')), Btn(t('a2.toInput'), () => go('input'), { variant: 'primary' })),
    h('label', { for: 'q', class: 'label' }, t('a3.prompt')), input,
    Btn(t('a3.send'), () => ask(state.question), { variant: 'primary', disabled: !state.memories.length }),
    h('p', { class: 'label' }, t('a3.chips')),
    h('div', { class: 'chips chips-wrap' }, ['a3.chip1', 'a3.chip2', 'a3.chip3', 'a3.chip4'].map((k) => h('button', {
      type: 'button', class: 'chip', disabled: !state.memories.length, onClick: () => { input.value = t(k); ask(t(k)); },
    }, t(k)))),
    ErrorBox(state.askError, { onDismiss: () => { state.askError = null; rerender(); } }),
    state.answer ? AnswerCard(state.answer) : null,
    // Optional, default input stays text. Shown only if the browser has speech recognition; labelled unverified.
    recognitionCtor()
      ? h('div', { class: 'card card-quiet' },
        Btn(state.listening ? t('mic.stop') : t('mic.start'), toggleMic, { variant: state.listening ? 'danger' : 'secondary' }),
        h('p', { class: 'small' }, t('mic.note')),
        state.micError ? h('p', { class: 'warn-strong', role: 'alert' }, state.micError) : null)
      : h('p', { class: 'small' }, t('mic.unsupported')));
}
