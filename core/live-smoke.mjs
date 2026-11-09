// DEV SMOKE (not QA evidence): runs core through the lead's real llm router on NEW synthetic text.
// Usage: node core/live-smoke.mjs   (spawns the already-authenticated cursor CLI via llm/router.mjs; cache disabled)
// Synthetic text only. No tools, no actions. Prints raw route/model/latency and validation outcome.
import { createCore } from './core.mjs';
import { createCursorLlm } from '../llm/router.mjs';

const llm = createCursorLlm({ cwd: process.env.SJ_ROOT ?? process.cwd(), cache: false });
const core = createCore({ now: () => '2026-11-09T10:30:00+09:00', llm, llmTimeoutMs: 150000 });

const text = [
  '정수: 아버지, 다음 주 목요일 오전 아홉 시 반에 박 원장님 내과에서 혈압 검사 받으세요.',
  '아버지: 목요일은 안 되는데. 수요일은 어때?',
  '정수: 그럼 수요일 오후 두 시로 바꿀게요.',
  '알 수 없음: 세 시에 경로당에서 장기 대회가 있대요.',
].join('\n');

const t0 = Date.now();
const r = await core.ingestText({ title: 'live smoke (new synthetic)', text, provenance: 'synthetic' });
console.log(JSON.stringify({ ingest: { ok: r.ok, mode: r.mode, route: r.route, rejected: r.rejected, rejectedDetail: r.rejectedDetail, created: r.memoriesCreated, superseded: r.superseded, retracted: r.retracted, unresolved: r.unresolved, fallbackReason: r.fallbackReason, ms: Date.now() - t0 } }, null, 1));
for (const m of core.listMemories({ includeSuperseded: true })) {
  console.log(JSON.stringify({ id: m.id, kind: m.kind, status: m.status, title: m.summary, who: m.who.display ?? null, when: m.when.state + ' ' + (m.when.value?.displayKo ?? ''), whenUnc: m.when.uncertainty, where: m.where.display ?? null, supersededBy: m.supersededBy ?? null, constraint: m.meta.constraint ?? null }));
}
for (const q of ['아버지 혈압 검사는 언제야?', '장기 대회는 누가 알려줬어?', 'What time is the senior center event, and where?', '금요일에 누구 만나?']) {
  const t1 = Date.now();
  const a = await core.query({ text: q, lang: /[가-힣]/.test(q) ? 'ko' : 'en' });
  console.log(JSON.stringify({ q, found: a.found, mode: a.mode, route: a.route, sentence: a.sentence, caveats: a.caveats, clarification: a.clarification?.slot, notFoundReason: a.notFoundReason, ms: Date.now() - t1 }));
}
