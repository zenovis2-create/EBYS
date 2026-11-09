// Default in-memory store. Everything core persists lives here so deletion can be verified by scanning dump().
import { tokens } from './util.mjs';

export function createMemoryStore() {
  const state = {
    sessions: new Map(), utterances: new Map(), memories: new Map(), proposals: new Map(),
    index: new Map(), // token -> Set(docId)   (docId = "utt:<id>" | "mem:<id>")
    seq: { ses: 0, utt: 0, mem: 0, prop: 0 },
    gen: { global: 0, data: 0 }, // global: bumped by deleteAll; data: bumped by any deletion (in-flight query guard)
    deletedSessions: new Set(), // ids only (no content)
    paused: false,
  };
  const api = {
    state,
    nextId(kind) { state.seq[kind] += 1; return `${kind === 'ses' ? 'ses' : kind === 'utt' ? 'utt' : kind === 'mem' ? 'mem' : 'prop'}_${state.seq[kind]}`; },
    indexDoc(docId, text) {
      for (const t of tokens(text)) { let set = state.index.get(t); if (!set) { set = new Set(); state.index.set(t, set); } set.add(docId); }
    },
    unindexDoc(docId) {
      for (const [t, set] of state.index) { set.delete(docId); if (!set.size) state.index.delete(t); }
    },
    /** Rebuild the whole index from remaining documents (used after deletion so no stale tokens survive). */
    reindexAll(memText) {
      state.index.clear();
      for (const u of state.utterances.values()) api.indexDoc(`utt:${u.id}`, u.text);
      for (const m of state.memories.values()) api.indexDoc(`mem:${m.id}`, memText(m));
    },
    search(text, limit = 10) {
      const score = new Map();
      for (const t of tokens(text)) for (const d of state.index.get(t) ?? []) score.set(d, (score.get(d) ?? 0) + 1);
      return [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([d, s]) => ({ docId: d, score: s }));
    },
    clearAll() {
      state.sessions.clear(); state.utterances.clear(); state.memories.clear(); state.proposals.clear(); state.index.clear();
      state.gen.global += 1; state.gen.data += 1;
    },
    /** JSON-serializable snapshot of every persisted string (for deletion verification). */
    dump() {
      return JSON.stringify({
        sessions: [...state.sessions.values()], utterances: [...state.utterances.values()],
        memories: [...state.memories.values()], proposals: [...state.proposals.values()],
        index: [...state.index.entries()].map(([k, v]) => [k, [...v]]),
      });
    },
  };
  return api;
}
