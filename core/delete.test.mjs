// Deletion / generation-counter tests (R03/R04). Fake llm: proves code only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCore } from './core.mjs';
import { fakeLlm, item, NOW } from './testkit.mjs';

const TEXT_A = '민지: 엄마, 다음 주 화요일 오후 세 시에 김 선생님 병원 예약했어요. SENTINEL-ALPHA-7731';
const TEXT_B = '준: 토요일 오후 두 시에 경로당 모임이 있어요. SENTINEL-BETA-2209';
const itemFor = (p) => {
  const t = p.utterances[0].text;
  if (t.includes('ALPHA')) return [item({ ref: 'a', quote: '다음 주 화요일 오후 세 시에 김 선생님 병원 예약했어요', u: 0, title: { ko: '김 선생님 병원 예약', en: 'Dr. Kim clinic' }, when: [[0, '다음 주 화요일 오후 세 시']], where: ['김 선생님 병원', 0] })];
  return [item({ ref: 'b', quote: '토요일 오후 두 시에 경로당 모임이 있어요', u: 0, title: { ko: '경로당 모임', en: 'Senior center meetup' }, when: [[0, '토요일 오후 두 시']], where: ['경로당', 0] })];
};
const mk = (llmOpts = {}, coreOpts = {}) => {
  const llm = fakeLlm({ extract: (req, p) => ({ items: itemFor(p) }), query: (req, p) => ({ found: true, memoryIds: p.memories.slice(-1).map((m) => m.id), asked: ['when'], slots: {} }), ...llmOpts });
  const core = createCore({ now: () => NOW, llm, ...coreOpts });
  return { core, llm };
};
const glue = [
  { name: 'action_ledger', purge: async () => ({ status: 'verified_deleted', detail: 'fake purger' }) },
  { name: 'notification_queue', purge: async () => ({ status: 'verified_deleted' }) },
  { name: 'exported_file', purge: async () => ({ status: 'not_applicable', detail: 'no export happened' }) },
  { name: 'external_calendar', purge: async () => ({ status: 'not_applicable', detail: 'no real adapter ran' }) },
];
const status = (receipt, name) => receipt.stores.find((s) => s.name === name)?.status;

test('deleteSession: removes transcript/memories/index/proposals/llm_cache; sentinel gone from every store; other session intact', async () => {
  const { core, llm } = mk({}, { purgers: glue });
  const a = await core.ingestText({ title: 'A', text: TEXT_A });
  const b = await core.ingestText({ title: 'B', text: TEXT_B });
  const ma = core.listMemories().find((m) => m.summary.en === 'Dr. Kim clinic');
  const pa = core.propose(ma.id); core.markConfirmed(pa.id, pa.revision);
  await core.query({ text: 'when is the meetup?' });
  assert.equal(core.getStorageSummary().sessions, 2);
  assert.ok(core._store.dump().includes('SENTINEL-ALPHA-7731'));
  assert.ok([...llm.cache.values()].some((c) => c.tags.includes(a.sessionId)));

  const receipt = await core.deleteSession(a.sessionId);
  for (const n of ['transcript', 'memories', 'search_index', 'proposals', 'llm_cache']) assert.equal(status(receipt, n), 'verified_deleted', n);
  assert.equal(receipt.allVerified, true);
  assert.ok(!core._store.dump().includes('SENTINEL-ALPHA-7731'), 'sentinel must not survive in any store/index');
  assert.ok(!core._store.dump().includes('김 선생님'));
  assert.equal([...llm.cache.values()].filter((c) => c.tags.includes(a.sessionId)).length, 0, 'llm_cache entries for the session purged');
  assert.ok(![...llm.cache.values()].some((c) => c.user.includes('Dr. Kim clinic') || c.user.includes('SENTINEL-ALPHA')), 'no cached prompt (incl. later sessions\' open-item context) still holds deleted content');
  assert.equal(core.getTranscript(a.sessionId).error.code, 'not_found');
  assert.equal(core.getMemory(ma.id).error.code, 'not_found');
  assert.equal(core.propose(ma.id).error.code, 'not_found');
  assert.equal(core.getStorageSummary().proposals, 0);
  assert.ok(core._store.dump().includes('SENTINEL-BETA-2209'), 'other session untouched');
  assert.equal(core.listMemories().length, 1);
});

test('receipt is never allVerified when a store cannot be verified (no purgers, or router without purgeCache)', async () => {
  const { core } = mk();
  const a = await core.ingestText({ title: 'A', text: TEXT_A });
  const r1 = await core.deleteSession(a.sessionId);
  assert.equal(status(r1, 'action_ledger'), 'not_verified'); assert.equal(r1.allVerified, false);
  assert.equal(status(r1, 'llm_cache'), 'verified_deleted');

  const { core: c2 } = mk({ purge: false }, { purgers: glue });
  const b = await c2.ingestText({ title: 'A', text: TEXT_A });
  const r2 = await c2.deleteSession(b.sessionId);
  assert.equal(status(r2, 'llm_cache'), 'not_verified'); assert.equal(r2.allVerified, false);
  assert.equal(status(r2, 'transcript'), 'verified_deleted');

  const { core: c3 } = mk({}, { purgers: [...glue.slice(0, 3), { name: 'external_calendar', purge: async () => { throw new Error('adapter down'); } }] });
  const d = await c3.ingestText({ title: 'A', text: TEXT_A });
  const r3 = await c3.deleteSession(d.sessionId);
  assert.equal(status(r3, 'external_calendar'), 'not_verified'); assert.equal(r3.allVerified, false);
});

test('deleteAll empties everything and purges the whole llm cache', async () => {
  const { core, llm } = mk({}, { purgers: glue });
  await core.ingestText({ title: 'A', text: TEXT_A }); await core.ingestText({ title: 'B', text: TEXT_B });
  const m = core.listMemories()[0]; core.propose(m.id);
  const r = await core.deleteAll();
  assert.equal(r.allVerified, true); assert.equal(r.scope, 'all');
  assert.deepEqual(core.getStorageSummary(), { sessions: 0, utterances: 0, memories: 0, proposals: 0, searchTerms: 0, paused: false });
  assert.equal(llm.cache.size, 0);
  const dump = core._store.dump();
  assert.ok(!dump.includes('SENTINEL') && !dump.includes('경로당'));
  const empty = await core.query({ text: 'anything' });
  assert.equal(empty.found, false); assert.equal(empty.notFoundReason, 'no_memory');
});

test('generation counter: ingest in flight when deleteAll runs is discarded, nothing stored', async () => {
  let release; const gate = new Promise((r) => { release = r; });
  const { core, llm } = mk({ gate });
  const pending = core.ingestText({ title: 'A', text: TEXT_A });
  for (let i = 0; i < 50 && llm.calls.length === 0; i++) await new Promise((r) => setTimeout(r, 5));
  assert.equal(llm.calls.length, 1, 'model call is in flight');
  await core.deleteAll();
  release();
  const r = await pending;
  assert.equal(r.ok, false); assert.equal(r.error.code, 'deleted_during_ingest');
  assert.deepEqual(core.getStorageSummary(), { sessions: 0, utterances: 0, memories: 0, proposals: 0, searchTerms: 0, paused: false });
  assert.ok(!core._store.dump().includes('SENTINEL'));
});

test('generation counter: query in flight when a deletion happens is discarded', async () => {
  let release; let gateOn = false; const gate = { then: (res, rej) => (gateOn ? new Promise((r) => { release = r; }).then(res, rej) : Promise.resolve().then(res, rej)) };
  const { core, llm } = mk({ gate });
  const a = await core.ingestText({ title: 'A', text: TEXT_A });
  gateOn = true;
  const q = core.query({ text: '언제?' });
  for (let i = 0; i < 50 && llm.calls.length < 2; i++) await new Promise((r) => setTimeout(r, 5));
  assert.equal(llm.calls.length, 2);
  await core.deleteSession(a.sessionId);
  release();
  const r = await q;
  assert.equal(r.ok, false); assert.equal(r.error.code, 'aborted_by_delete');
});

test('deleting a session that holds a superseding/constraint item reverts earlier items; deleting the original removes evidence-linked copies', async () => {
  const llm = fakeLlm({
    extract: (req, p) => {
      const t = p.utterances[0].text;
      if (t.includes('안 돼')) return { items: [item({ ref: 'n', cue: 'negation_unavailable', quote: '금요일은 안 돼', u: 0, title: { ko: '금요일 불가', en: 'Friday unavailable' }, when: [[0, '금요일']] })] };
      return { items: [item({ ref: 'l', quote: '금요일 점심 먹자', u: 0, title: { ko: '점심', en: 'Lunch' }, when: [[0, '금요일 점심']] })] };
    },
  });
  const core = createCore({ now: () => NOW, llm });
  const a = await core.ingestText({ title: 'ask', text: '준: 금요일 점심 먹자' });
  const b = await core.ingestText({ title: 'no', text: '박 할머니: 금요일은 안 돼' });
  const lunch = core.listMemories({ includeSuperseded: true }).find((m) => m.kind === 'event');
  assert.equal(lunch.status, 'retracted');
  await core.deleteSession(b.sessionId);
  assert.equal(core.getMemory(lunch.id).status, 'candidate', 'retraction came from deleted session => reverts');
  assert.equal(core.listMemories({ includeSuperseded: true }).filter((m) => m.meta.constraint).length, 0);
  await core.deleteSession(a.sessionId);
  assert.equal(core.listMemories({ includeSuperseded: true }).length, 0);
  assert.equal(core.getStorageSummary().searchTerms, 0);
});
