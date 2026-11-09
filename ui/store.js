// Single in-memory UI state. Nothing is persisted to localStorage/cookies (privacy: data stays in the page).

export const state = {
  route: 'input',
  scale: 1,
  paused: false,
  voiceOn: false,       // auto read-aloud preference (in memory only; not persisted)
  listening: false,     // browser speech input active (privacy bar turns red)
  micError: null,
  speaking: null,       // id of the text being read aloud
  runtime: null,        // GET /api/runtime
  lastModel: null,      // { mode, route:{id,model,cached} } from last model-backed call
  // input
  title: '', text: '', provenance: 'synthetic', consent: false, inputError: null,
  lastIngest: null,
  // data
  sessions: [],         // [{ sessionId, title, utterances }]
  utterances: new Map(),// id -> utterance (for evidence drawer)
  memories: [],
  filter: 'all',
  openTranscript: false,
  highlightUtterance: null,
  // ask
  question: '', answer: null, askError: null,
  // proposals tracker (Plans) and active flow
  plans: new Map(),     // proposalId -> { proposal, preview?, previewDigest?, record?, doneByMe? }
  flow: null,           // { proposalId, step: 'review'|'form'|'confirm'|'result', formMode, error, confirming }
  // privacy
  receipt: null, confirmDelete: null,
};

export const app = { api: null, apiKind: 'fixture' };

let renderer = () => {};
export function setRenderer(fn) { renderer = fn; }
export function rerender() { renderer(); }
export function go(route, { focus = true } = {}) {
  state.route = route;
  renderer({ focus });
}

export function noteSession({ sessionId, title, utterances }) {
  state.sessions = state.sessions.filter((s) => s.sessionId !== sessionId);
  state.sessions.push({ sessionId, title, utterances });
  for (const u of utterances ?? []) state.utterances.set(u.id, u);
}

export function resetData({ sessionId, all } = {}) {
  if (all) {
    state.sessions = []; state.utterances = new Map(); state.memories = []; state.plans = new Map();
    state.flow = null; state.answer = null; state.lastIngest = null;
    return;
  }
  const s = state.sessions.find((x) => x.sessionId === sessionId);
  for (const u of s?.utterances ?? []) state.utterances.delete(u.id);
  state.sessions = state.sessions.filter((x) => x.sessionId !== sessionId);
  state.memories = state.memories.filter((m) => !m.id.startsWith(`${sessionId}-`) && !(m.evidence ?? []).some((e) => e.utteranceId?.startsWith(`${sessionId}-`)));
  for (const [id, p] of state.plans) {
    const gone = (p.proposal.evidence ?? []).some((e) => e.utteranceId?.startsWith(`${sessionId}-`));
    if (gone) state.plans.delete(id);
  }
  if (state.flow && !state.plans.has(state.flow.proposalId)) state.flow = null;
  state.answer = null;
}

export function trackProposal(proposal, patch = {}) {
  const prev = state.plans.get(proposal.id) ?? {};
  state.plans.set(proposal.id, { ...prev, ...patch, proposal });
  return state.plans.get(proposal.id);
}
