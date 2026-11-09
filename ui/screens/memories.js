// A2 Memories with evidence drawer
import { h } from '../lib/dom.js';
import { t, pick } from '../i18n.js';
import { state, app, go, rerender, trackProposal } from '../store.js';
import { Btn, StateBadge, UncBadge, ErrorBox, openEvidence, slotText, langOf } from '../components.js';
import { Icon } from '../lib/icons.js';
import { runWithProgress } from '../progress.js';
import { loadMemories } from './input.js';

const KINDS = ['all', 'event', 'task', 'person', 'fact'];
const INACTIVE = new Set(['superseded', 'retracted', 'cancelled', 'deleted']);

export async function startProposal(memoryId) {
  const res = await runWithProgress('prog.propose', (signal) => app.api.propose({ memoryId }, { signal }));
  if (!res.ok) {
    if (state.route === 'ask') state.askError = res.error; else state.memError = res.error;
    return rerender();
  }
  openProposal(res.data);
}

export function openProposal(proposal) {
  trackProposal(proposal);
  state.flow = { proposalId: proposal.id, step: 'review', formMode: null, error: null, confirming: false };
  go('proposal');
}

const SLOT_ICON = { who: 'person', when: 'clock', where: 'pin', what: 'note' };
function memorySlotsLine(m) {
  return h('dl', { class: 'facts' }, ['who', 'when', 'where'].map((k) => {
    const s = m[k];
    const text = slotText(s);
    return h('div', { class: 'fact' },
      h('dt', null, Icon(SLOT_ICON[k], { size: 24 }), h('span', null, t(`slot.${k}`))),
      text ? h('dd', { lang: langOf(text) }, text, ' ', UncBadge(s.uncertainty)) : h('dd', { class: 'slot-unknown-inline' }, t('slot.unknown')));
  }));
}

function MemoryCard(m, byId) {
  const inactive = INACTIVE.has(m.status);
  const evs = m.evidence ?? [];
  const next = m.supersededBy ? byId.get(m.supersededBy) : null;
  const canPropose = !inactive && (m.kind === 'event' || m.kind === 'task');
  return h('article', { class: `card mem ${inactive ? 'mem-inactive' : ''}`, 'data-memory': m.id },
    h('div', { class: 'mem-head' },
      h('span', { class: 'kind-chip' }, t(`a2.${m.kind}`) ?? m.kind),
      inactive ? StateBadge(m.status === 'superseded' ? 'superseded' : m.status === 'cancelled' ? 'cancelled' : 'expired') : StateBadge('candidate')),
    h('h3', { class: 'mem-summary', lang: langOf(pick(m.summary)) }, pick(m.summary)),
    m.kind === 'event' || m.kind === 'task' ? memorySlotsLine(m) : null,
    next ? h('p', { class: 'small' }, t('a2.changedTo', { s: pick(next.summary) })) : null,
    h('div', { class: 'stack' },
      evs.length
        ? Btn([Icon('quote', { size: 24 }), ' ', t('a2.evidence', { n: evs.length })], () => openEvidence(evs), { variant: 'secondary' })
        : h('p', { class: 'warn' }, t('a2.noEvidence')),
      canPropose ? Btn(m.kind === 'task' ? t('a2.proposeTodo') : t('a2.propose'), () => startProposal(m.id), { variant: 'primary' }) : null));
}

function Transcript() {
  const rows = state.sessions.flatMap((s) => s.utterances ?? []);
  if (!rows.length) return null;
  const det = h('details', { class: 'card', open: state.openTranscript },
    h('summary', null, t('a2.transcript', { n: rows.length })),
    h('ol', { class: 'transcript' }, rows.map((u) => h('li', {
      id: `u-${u.id}`, class: `utt ${state.highlightUtterance === u.id ? 'utt-hl' : ''}`, lang: langOf(u.text),
    }, h('span', { class: `speaker ${u.speakerKnown === false ? 'speaker-unknown' : ''}` },
      u.speakerKnown === false ? t('a2.unknownSpeaker') : u.speakerLabel), ': ', u.text))));
  det.addEventListener('toggle', () => { state.openTranscript = det.open; });
  return det;
}

export function renderMemories() {
  const all = state.memories;
  const byId = new Map(all.map((m) => [m.id, m]));
  const shown = all.filter((m) => state.filter === 'all' || m.kind === state.filter);
  const active = shown.filter((m) => !INACTIVE.has(m.status));
  const past = shown.filter((m) => INACTIVE.has(m.status));
  const last = state.lastIngest;
  const el = h('section', { 'aria-labelledby': 'screen-title' },
    h('h1', { id: 'screen-title', tabindex: '-1' }, t('a2.title')),
    last && (last.mode === 'fallback' || last.mode === 'fixture')
      ? h('p', { class: 'note note-fixture' }, t(last.mode === 'fallback' ? 'a1.lastMode.fallback' : 'a1.lastMode.fixture')) : null,
    last?.rejected ? h('p', { class: 'warn' }, t('a2.rejectedNote', { n: last.rejected })) : null,
    ErrorBox(state.memError, { onDismiss: () => { state.memError = null; rerender(); } }),
    all.length
      ? h('div', { class: 'chips', role: 'group', 'aria-label': t('a2.title') },
        KINDS.map((k) => h('button', {
          type: 'button', class: `chip ${state.filter === k ? 'chip-on' : ''}`, 'aria-pressed': String(state.filter === k),
          onClick: () => { state.filter = k; rerender(); },
        }, t(`a2.${k}`))))
      : null,
    all.length ? null : h('div', { class: 'card' }, h('p', null, t('a2.empty')), Btn(t('a2.toInput'), () => go('input'), { variant: 'primary' })),
    active.map((m) => MemoryCard(m, byId)),
    past.length ? h('h2', null, t('a2.superseded')) : null,
    past.map((m) => MemoryCard(m, byId)),
    Transcript(),
    all.length ? Btn(t('a2.refresh'), async () => { await loadMemories(); rerender(); }, { variant: 'link' }) : null);
  if (state.highlightUtterance) {
    queueMicrotask(() => {
      document.getElementById(`u-${state.highlightUtterance}`)?.scrollIntoView({ block: 'center' });
      state.highlightUtterance = null;
    });
  }
  return el;
}
