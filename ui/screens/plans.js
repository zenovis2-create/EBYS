// A5 Plans (appointments + todos) with distinct states
import { h } from '../lib/dom.js';
import { t, pick, getLang } from '../i18n.js';
import { state, go, rerender } from '../store.js';
import { Btn, StateBadge } from '../components.js';
import { proposalBadgeKey, reopenProposal } from './proposal.js';
import { formatWhen } from '../lib/time.js';
import { startProposal } from './memories.js';

const ATTENTION = new Set(['needs_info', 'proposed', 'user_confirmed', 'executing']);
const DONE = new Set(['completed_external', 'simulated_completed', 'handed_off', 'user_attested']);
const PROBLEM = new Set(['failed', 'permission_denied', 'unknown_outcome', 'verify_mismatch']);

function PlanRow(entry) {
  const p = entry.proposal;
  const key = entry.doneByMe ? 'user_marked_done' : proposalBadgeKey(entry);
  const when = formatWhen(p.fields.startsAt, getLang());
  return h('article', { class: `card statecard st-${key}`, 'data-proposal': p.id },
    StateBadge(key),
    h('h3', null, p.fields.title || t('a5.untitled')),
    h('p', null, when ?? t('slot.unknown'), p.fields.where ? ` · ${p.fields.where}` : ''),
    p.fields.kind === 'todo' && !entry.doneByMe && key !== 'cancelled'
      ? Btn(t('a5.markDone'), () => { entry.doneByMe = true; rerender(); }) : null,
    entry.doneByMe ? h('p', { class: 'small' }, t('a5.doneByMe')) : null,
    Btn(t('a5.open'), () => reopenProposal(p.id), { variant: 'link' }));
}

function Group(titleKey, entries) {
  if (!entries.length) return null;
  return h('div', null, h('h2', null, t(titleKey)), entries.map(PlanRow));
}

export function renderPlans() {
  const entries = [...state.plans.values()];
  const keyOf = (e) => (e.doneByMe ? 'user_marked_done' : proposalBadgeKey(e));
  const attention = entries.filter((e) => ATTENTION.has(keyOf(e)));
  const done = entries.filter((e) => DONE.has(keyOf(e)) || e.doneByMe);
  const problems = entries.filter((e) => PROBLEM.has(keyOf(e)));
  const closed = entries.filter((e) => ['cancelled', 'expired'].includes(keyOf(e)));
  const taskCandidates = state.memories.filter((m) => m.kind === 'task' && m.status === 'candidate'
    && ![...state.plans.values()].some((e) => e.proposal.fields.sourceMemoryIds?.includes(m.id)));
  return h('section', { 'aria-labelledby': 'screen-title' },
    h('h1', { id: 'screen-title', tabindex: '-1' }, t('a5.title')),
    entries.length || taskCandidates.length ? null : h('p', null, t('a5.empty')),
    Group('a5.needsAttention', attention),
    Group('a5.problems', problems),
    Group('a5.saved', done),
    taskCandidates.length ? h('div', null, h('h2', null, t('a5.todoCandidates')),
      taskCandidates.map((m) => h('article', { class: 'card statecard st-candidate' }, StateBadge('candidate'), h('p', null, pick(m.summary)),
        Btn(t('a2.proposeTodo'), () => startProposal(m.id))))) : null,
    Group('a5.closed', closed));
}
