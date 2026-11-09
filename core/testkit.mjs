// TEST HELPERS ONLY. A FAKE llm proves the validation/consolidation CODE, never the AI.
// Real-model evidence must come from a live route run on held-out text (CONTRACTS 6b).

export const NOW = '2026-11-09T10:30:00+09:00';

/** Item builder for scripted fake-model output. quote strings are looked up by the tests (must be verbatim to pass). */
export function item(o) {
  return {
    ref: o.ref, kind: o.kind ?? 'event', cue: o.cue ?? 'propose', title: o.title ?? { ko: o.titleKo ?? o.quote, en: o.titleEn ?? o.quote },
    quote: o.quote, utterance: o.u,
    who: (o.who ?? []).map(([name, u, quote]) => ({ name, quote: quote ?? name, utterance: u })),
    when: (o.when ?? []).map(([u, quote]) => ({ quote, utterance: u })),
    where: o.where ? { name: o.where[0], quote: o.where[2] ?? o.where[0], utterance: o.where[1] } : null,
    what: o.what ? { text: o.what[0], quote: o.what[2] ?? o.what[0], utterance: o.what[1] } : null,
    target: o.target ?? null, confidence: o.confidence ?? 'stated',
  };
}

/**
 * Fake llm. handlers.extract(req, parsed) / handlers.query(req, parsed) return JSON (or {ok:false,...} via handlers.fail).
 * Records calls, simulates a tag-addressable response cache and purgeCache().
 */
export function fakeLlm({ extract, query, summary, classify, fail = null, delayMs = 0, gate = null, purge = true } = {}) {
  const calls = []; const cache = new Map();
  return {
    calls, cache,
    describe: () => ({ route: 'fake', model: 'fake-model', healthy: true }),
    async generateJson(req) {
      let parsed; try { parsed = JSON.parse(req.user); } catch { parsed = null; }
      calls.push({ req, parsed });
      if (gate) await gate;
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      cache.set(String(calls.length), { tags: req.tags ?? [], user: req.user });
      if (fail) return { ok: false, route: 'fake', error: { code: fail, message: `fake failure ${fail}`, retryable: true } };
      const kind = parsed?.task;
      const h = { extract_memory: extract, answer_question: query, summarize_window: summary, classify_request: classify }[kind] ?? null;
      if (!h) return { ok: false, route: 'fake', error: { code: 'unscripted', message: String(kind), retryable: false } };
      const json = await h(req, parsed);
      return { ok: true, json, route: 'fake', model: 'fake-model', ms: 1 };
    },
    ...(purge ? {
      purgeCache({ tag, all } = {}) {
        let removed = 0;
        for (const [k, v] of [...cache]) if (all || (tag && v.tags.includes(tag))) { cache.delete(k); removed++; }
        return { removed, verified: true };
      },
    } : {}),
  };
}
