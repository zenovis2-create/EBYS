// DEV SMOKE (not QA evidence): English-first run of core through the lead's real llm router on NEW synthetic English text.
// Usage: SJ_ROOT=<senior-jarvis dir> node core/live-smoke-en.mjs   (spawns the already-authenticated cursor CLI via llm/router.mjs; cache off)
// Synthetic text only. No tools, no actions. Prints route/model/latency/telemetry presence and answers.
import { createCore } from './core.mjs';
import { createCursorLlm } from '../llm/router.mjs';

const llm = createCursorLlm({ cwd: process.env.SJ_ROOT ?? process.cwd(), cache: false });
const core = createCore({ now: () => '2026-11-09T11:40:00+09:00', llm, llmTimeoutMs: 170000 });

const text = [
  "Odette: Hi Ravi, can you join the birdwatching walk at Willow Marsh next Saturday at eight?",
  "Ravi: I can't make Saturday, I'm at my niece's recital. How about Sunday instead?",
  "Odette: Sunday is fine. I'll bring the binoculars and the thermos.",
  "Please remember the library book is due on the 24th.",
  "Odette: Oh, and the walk is off if it rains.",
].join('\n');

const t0 = Date.now();
const r = await core.ingestText({ title: 'live smoke EN (new synthetic)', text, provenance: 'synthetic' });
console.log(JSON.stringify({ ingest: { ok: r.ok, mode: r.mode, route: r.route, rejected: r.rejected, rejectedDetail: r.rejectedDetail, created: r.memoriesCreated, superseded: r.superseded, retracted: r.retracted, cancelled: r.cancelled, unresolved: r.unresolved, fallbackReason: r.fallbackReason, telemetryKeys: r.telemetry && Object.keys(r.telemetry), rawModelJsonItems: r.telemetry?.rawModelJson?.items?.length ?? null, ms: Date.now() - t0 } }, null, 1));
for (const m of core.listMemories({ includeSuperseded: true })) {
  console.log(JSON.stringify({ id: m.id, kind: m.kind, status: m.status, title: m.summary.en, who: m.who.display ?? null, when: `${m.when.state} ${m.when.value?.displayEn ?? ''}`, whenUnc: m.when.uncertainty, clarification: m.when.clarification?.en ?? null, where: m.where.display ?? null, question: m.meta.question, constraint: m.meta.constraint ?? null, supersededBy: m.supersededBy ?? null }));
}
for (const q of ['Where is the birdwatching walk?', 'When is the birdwatching walk?', 'Who is bringing the binoculars?', 'When is the library book due?', 'What is the name of the guide?']) {
  const t1 = Date.now();
  const a = await core.query({ text: q });
  console.log(JSON.stringify({ q, found: a.found, mode: a.mode, route: a.route, sentence: a.sentence?.en, caveats: a.caveats, clarification: a.clarification && { slot: a.clarification.slot, prompt: a.clarification.prompt.en, options: a.clarification.options.map((o) => o.labelEn) }, notFoundCode: a.notFoundCode, rejectedSlots: a.rejectedSlots, evidence: Object.values(a.slots).flatMap((s) => s.evidence).map((e) => e.quote), telemetryHasRaw: a.telemetry?.rawModelJson != null, ms: Date.now() - t1 }));
}
const c = await core.classifyRequest('Add a doctor visit next Tuesday at two');
console.log(JSON.stringify({ classify: { kind: c.kind, mode: c.mode, route: c.route, when: c.slots.when.state, clarification: c.slots.when.clarification?.en, rejected: c.rejected } }));
