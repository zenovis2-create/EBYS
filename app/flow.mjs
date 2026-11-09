// Lead glue: the only place that connects core (memory), adapters (actions) and the model route.
// Confirmation binding (review R01): the digest the user saw must match a freshly computed preview of the
// current proposal revision, otherwise nothing is dispatched.
import { createCore } from '../core/index.mjs';
import { createActionService, intentFromProposal } from '../adapters/index.mjs';
import { displayState } from '../contracts/contracts.js';

const fail = (code, message, extra = {}) => ({ ok: false, error: { code, message, retryable: false, ...extra } });

const CALENDAR_MODES = {
  simulated: { mode: 'simulated' },
  local: { mode: 'real', real: 'local' },
  ics: { mode: 'real', real: 'ics' },
};

export function createFlow({ llm: baseLlm, now = () => new Date(), calendarMode = 'simulated', calendarFile, adapters = {} } = {}) {
  const cal = CALENDAR_MODES[calendarMode];
  if (!cal) throw new TypeError(`calendar mode must be one of ${Object.keys(CALENDAR_MODES).join(', ')}, got ${calendarMode}`);
  const service = createActionService({ now, ...cal, calendarFile, adapters });
  const calls = [];
  const llm = baseLlm && {
    ...baseLlm,
    async generateJson(req) {
      const res = await baseLlm.generateJson(req);
      calls.push({ ok: !!res?.ok, json: res?.ok ? res.json : null, route: res?.route, model: res?.model, cached: !!res?.cached, ms: res?.ms, error: res?.ok ? undefined : res?.error });
      return res;
    },
  };
  // Serialized so the model calls made during one ingest/query are exactly the ones attributed to it.
  let chain = Promise.resolve();
  function traced(fn) {
    const run = chain.then(async () => {
      const start = calls.length;
      const result = await fn();
      return { result, made: calls.slice(start) };
    });
    chain = run.catch(() => {});
    return run;
  }
  function telemetry(result, made) {
    const last = made[made.length - 1];
    const rejected = Number.isInteger(result?.rejected) ? result.rejected : 0;
    return {
      mode: result?.mode ?? 'none',
      route: result?.route ?? null,
      modelCalls: made.map(({ json, ...c }) => c),
      rawModelJson: last?.json ?? null,
      validation: {
        ok: result?.mode === 'model',
        rejected,
        ...(result?.mode === 'model' ? {} : { reason: result?.fallbackReason ?? result?.route?.error ?? last?.error ?? null }),
      },
      rejected,
    };
  }
  async function withTelemetry(fn) {
    const { result, made } = await traced(fn);
    if (!result || result.ok === false) return result;
    return { ...result, telemetry: telemetry(result, made) };
  }
  const purgers = [
    { name: 'action_ledger', purge: (arg) => service.purge({ sessionId: arg?.sessionId }) },
    { name: 'llm_cache', purge: async () => ({ status: llm?.purgeCache ? await llm.purgeCache() : 'not_applicable' }) },
  ];
  // Cursor CLI calls take 30-90 s while other Cursor agents share the machine.
  const core = createCore({ now, llm, purgers, llmTimeoutMs: 150_000 });
  const proposals = () => core._store.state.proposals;

  function currentProposal(id) {
    const p = proposals().get(id);
    return p ? structuredClone(p) : null;
  }

  function intentFor(p) {
    const sessionId = core.getMemory(p.fields.sourceMemoryIds?.[0])?.sessionId;
    return { ...intentFromProposal(p, { sessionId }), proposalState: p.state };
  }

  function preview({ proposalId }) {
    const p = currentProposal(proposalId);
    if (!p) return fail('not_found', 'proposal not found');
    if (p.state === 'cancelled' || p.state === 'expired') return fail('proposal_closed', `proposal is ${p.state}`);
    const pv = service.preview(intentFor(p));
    if (pv.needs_clarification) return { proposalId, revision: p.revision, needs_clarification: pv };
    return { proposalId, revision: p.revision, preview: pv, previewDigest: pv.previewDigest, mode: pv.mode, adapterId: pv.adapterId };
  }

  async function confirm({ proposalId, previewDigest }) {
    const p = currentProposal(proposalId);
    if (!p) return fail('not_found', 'proposal not found');
    if (p.state === 'cancelled' || p.state === 'expired') return fail('proposal_closed', `proposal is ${p.state}`);
    const stale = (p.fields.sourceMemoryIds ?? []).filter((id) => {
      const m = core.getMemory(id);
      return !m || m.status === 'cancelled' || m.status === 'superseded' || m.status === 'retracted' || m.status === 'deleted';
    });
    if (stale.length) return fail('source_changed', 'the conversation this came from was cancelled or changed; nothing was saved', { sourceMemoryIds: stale });
    const intent = intentFor(p);
    const fresh = service.preview(intent);
    if (fresh.needs_clarification) return fail('needs_clarification', 'proposal is not exact yet', { missing: fresh.missing });
    if (fresh.previewDigest !== previewDigest) return fail('stale_preview', 'the details changed after you reviewed them; please review again');
    const marked = core.markConfirmed(p.id, p.revision);
    if (marked.ok === false) return marked;
    const rec = await service.confirm({ intent, previewDigest });
    if (rec.ok === false) return rec;
    core.setActionRecord(p.id, rec.recordId);
    return { ...rec, displayState: displayState(rec) };
  }

  async function remove({ sessionId, all }) {
    return all ? core.deleteAll() : core.deleteSession(sessionId);
  }

  function runtime() {
    return { ...service.describe(), model: llm?.describe?.() ?? { route: 'none', model: 'none', healthy: false } };
  }

  return {
    core,
    service,
    ingest: (args) => withTelemetry(() => core.ingestText(args)),
    memories: () => ({ memories: core.listMemories({ includeSuperseded: true }) }),
    query: (args = {}) => withTelemetry(() => core.query({ ...args, lang: args.lang ?? (/[\uac00-\ud7a3]/.test(args.text ?? '') ? 'ko' : 'en') })),
    propose: ({ memoryId }) => core.propose(memoryId),
    updateProposal: (id, patch) => core.updateProposal(id, patch),
    cancelProposal: (id) => core.cancelProposal(id),
    preview,
    confirm,
    records: () => ({ records: service.list().map((r) => ({ ...r, displayState: displayState(r) })) }),
    readback: async (recordId) => {
      const rec = await service.readback(recordId);
      return rec?.ok === false ? rec : { ...rec, displayState: displayState(rec) };
    },
    notifications: ({ since = 0 } = {}) => service.dueNotifications(undefined, { since: Number(since) || 0 }),
    summary: (args) => core.summarizeWindow(args),
    remove,
    runtime,
  };
}
