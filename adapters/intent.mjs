// Proposal -> ActionIntent mapping (CONTRACTS section 5). Pure, browser-safe. Owner: sj-actions.
// Never invents a time: anything that is not a full ISO datetime with offset is not 'exact'.
import { TZ } from '../contracts/contracts.js';
import { parseExactIso, isDateOnly } from './format.mjs';

const NOT_EXACT_UNCERTAINTY = new Set(['ambiguous', 'unknown', 'approximate', 'conflicting', 'superseded']);

/**
 * @param {object} proposal core Proposal ({ id, revision, fields, state, missing, slotUncertainty, evidence })
 * @param {{ sessionId?: string }} [opts] sessionId lets purge() find the record later (lead glue passes it)
 */
export function intentFromProposal(proposal, opts = {}) {
  const f = proposal?.fields ?? {};
  const wu = proposal?.slotUncertainty?.when;
  const missingWhen = Array.isArray(proposal?.missing) && proposal.missing.includes('when');

  let precision;
  if (!f.startsAt || missingWhen) precision = 'unknown';
  else if (wu && NOT_EXACT_UNCERTAINTY.has(wu)) precision = wu === 'unknown' ? 'unknown' : 'ambiguous';
  else if (parseExactIso(f.startsAt) !== null) precision = 'exact';
  else if (isDateOnly(f.startsAt)) precision = 'date_only';
  else precision = 'ambiguous';

  let durationMin;
  if (f.startsAt && f.endsAt) {
    const a = parseExactIso(f.startsAt);
    const b = parseExactIso(f.endsAt);
    if (a !== null && b !== null && b > a) durationMin = Math.round((b - a) / 60000);
  }

  const wh = proposal?.slotUncertainty?.who;
  const speakerConfidence = !f.who ? 'unknown' : wh === 'stated' ? 'confirmed' : wh === 'inferred' ? 'inferred' : 'unknown';

  return {
    intentId: proposal?.id,
    revision: proposal?.revision,
    kind: f.kind === 'todo' ? 'reminder' : 'appointment',
    title: f.title,
    person: { displayName: f.who ?? null, speakerConfidence },
    when: { precision, startIso: precision === 'exact' ? f.startsAt : undefined, tz: TZ, durationMin },
    place: f.where ?? null,
    reminderOffsetsMin: Array.isArray(f.remindOffsetsMin) ? [...f.remindOffsetsMin] : [],
    sourceRefs: Array.isArray(proposal?.evidence) ? proposal.evidence : [],
    uncertainty: Object.entries(proposal?.slotUncertainty ?? {}).filter(([, v]) => v && v !== 'stated').map(([k, v]) => `${k}:${v}`),
    // additive fields (not in the frozen typedef): used for stale/cancelled rejection and purge scoping
    proposalState: proposal?.state,
    sessionId: opts.sessionId,
  };
}
