// Synthetic in-memory policy tests only. No server, model, browser, filesystem mutation or calendar calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFreezeSignal, freezeErrors, authorizeScopedDelete, receiptErrors, sourceValueErrors, modelBudgetMs } from './freeze-policy.mjs';
import { runFreeze } from './run-freeze-qa.mjs';
const expected = { server: 'a'.repeat(12), ui: 'b'.repeat(12) };
const runtime = () => ({ version: 'test-only', mode: 'real', calendar: { kind: 'ebys_local' }, adapters: [{ id: 'calendar.local', mode: 'real' }],
  sourceSnapshot: { serverCurrent: true, serverLoaded: { sha256: 'a'.repeat(64), startedAt: '2026-11-09T05:00:00Z' }, serverOnDisk: { sha256: 'a'.repeat(64) }, uiOnDisk: { sha256: 'b'.repeat(64) } } });
const ownership = () => new Map([['own', { runId: 'run', createdHere: true, duplicate: false }]]);
test('signal required; placeholders, previous ready wording and missing hashes rejected', () => {
  assert.deepEqual(parseFreezeSignal(`LEAD-READY-FREEZE ${expected.server} ${expected.ui}`), expected);
  for (const bad of [undefined, 'LEAD-READY', 'LEAD-READY-FREEZE <server sha12> <ui sha12>', 'LEAD-READY-FREEZE a b']) assert.throws(() => parseFreezeSignal(bad));
});
test('freeze accepts exact current runtime, rejects either hash, stale disk or restarted instance', () => {
  assert.deepEqual(freezeErrors(runtime(), expected), []);
  for (const mutation of ['ui', 'disk', 'restart']) { const r = runtime(); const anchor = runtime();
    if (mutation === 'ui') r.sourceSnapshot.uiOnDisk.sha256 = 'c'.repeat(64);
    if (mutation === 'disk') r.sourceSnapshot.serverCurrent = false;
    if (mutation === 'restart') r.sourceSnapshot.serverLoaded.startedAt = '2026-11-09T05:01:00Z';
    assert.ok(freezeErrors(r, expected, anchor).length); }
});
test('only a session created here may be deleted; all:true, all:false and other fields refused', () => {
  assert.equal(authorizeScopedDelete({ sessionId: 'own' }, ownership(), runtime(), runtime(), 'run'), 'own');
  for (const payload of [{ all: true }, { sessionId: 'own', all: false }, { sessionId: 'someone-else' }, { sessionId: 'own', force: true }]) assert.throws(() => authorizeScopedDelete(payload, ownership(), runtime(), runtime(), 'run'));
});
test('same session ID after restart and deduplicated/unowned sessions cannot be cleaned', () => {
  const r = runtime(); r.sourceSnapshot.serverLoaded.startedAt = '2026-11-09T05:02:00Z';
  assert.throws(() => authorizeScopedDelete({ sessionId: 'own' }, ownership(), r, runtime(), 'run'));
  for (const entry of [{ runId: 'other', createdHere: true, duplicate: false }, { runId: 'run', createdHere: true, duplicate: true }]) assert.throws(() => authorizeScopedDelete({ sessionId: 'own' }, new Map([['own', entry]]), runtime(), runtime(), 'run'));
});
test('UI drift fails freeze but does not widen or prevent safe same-backend scoped cleanup', () => {
  const r = runtime(); r.sourceSnapshot.uiOnDisk.sha256 = 'c'.repeat(64);
  assert.ok(freezeErrors(r, expected, runtime()).length);
  assert.equal(authorizeScopedDelete({ sessionId: 'own' }, ownership(), r, runtime(), 'run'), 'own');
});
test('receipt must identify exact session and preserve unverified-copy failures', () => {
  const receipt = { scope: 'session:own', allVerified: true, stores: ['transcript', 'memories', 'search_index', 'proposals', 'action_ledger', 'llm_cache'].map(name => ({ name, status: 'verified_deleted' })) };
  assert.deepEqual(receiptErrors(receipt, 'own'), []);
  assert.ok(receiptErrors(receipt, 'other').length);
  receipt.stores.push({ name: 'notification_queue', status: 'not_verified' });
  assert.ok(receiptErrors(receipt, 'own').length);
});
test('a real quote cannot support an unrelated known person or place', () => {
  const answer = { slots: { who: { state: 'known', value: [{ name: 'Kai' }], evidence: [{ quote: 'Kai at Glass Meadow workshop' }] }, where: { state: 'known', value: { name: 'Glass Meadow workshop' }, evidence: [{ quote: 'at Glass Meadow workshop' }] } } };
  assert.deepEqual(sourceValueErrors(answer), []);
  answer.slots.where.value.name = 'An unrelated hospital';
  assert.equal(sourceValueErrors(answer).length, 1);
});
test('own memory session ID cannot authorize purging a baseline calendar event from a prior run', () => {
  assert.throws(() => authorizeScopedDelete({ sessionId: 'own' }, ownership(), runtime(), runtime(), 'run', new Set(['own'])));
});
test('missing real-shaped signal rejects before any IO/network runner action', async () => {
  let calls = 0;
  await assert.rejects(runFreeze({ signal: 'NOT-READY', fetchImpl: async () => { calls++; throw new Error('must not be reached'); } }), /signal required/);
  assert.equal(calls, 0);
});
test('model deadline reserves two minutes for cleanup after the maximum model timeout', () => {
  assert.equal(modelBudgetMs(0, 300000), 180000);
  assert.throws(() => modelBudgetMs(1, 300000), /cleanup reserve/);
});
