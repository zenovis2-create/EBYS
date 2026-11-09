import test from 'node:test';
import assert from 'node:assert/strict';
import { createFlow } from './flow.mjs';
import { createFakeLlm } from '../llm/router.mjs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const now = () => new Date('2026-11-09T10:30:00+09:00');

async function flowWithEvent() {
  const flow = createFlow({ llm: null, now });
  await flow.ingest({
    title: 'synthetic clinic',
    provenance: 'synthetic',
    text: '딸: 엄마, 다음 주 화요일 오후 3시에 중앙병원 김 선생님 예약했어요.\n엄마: 그래, 알았다.',
  });
  const mem = flow.memories().memories.find((m) => m.kind === 'event');
  assert.ok(mem, 'fallback extraction produced an event');
  return { flow, mem };
}

test('confirm dispatches only for the digest the user saw', async () => {
  const { flow, mem } = await flowWithEvent();
  const p = flow.propose({ memoryId: mem.id });
  const id = p.id ?? p.proposal?.id;
  const pv = flow.preview({ proposalId: id });
  if (pv.needs_clarification) return;
  const bad = await flow.confirm({ proposalId: id, previewDigest: 'not-the-digest' });
  assert.equal(bad.error?.code, 'stale_preview');
  assert.equal(flow.records().records.length, 0);
});

const EN_TEXT = 'Maya: Dad, your eye appointment with Dr. Lee is next Tuesday at 10:30 AM at Riverside Clinic.\nDad: Okay, thanks.';

test('telemetry attributes the raw model JSON and validation to the ingest that made the call', async () => {
  const raw = { items: 'not-a-valid-extraction' };
  const flow = createFlow({ llm: createFakeLlm(() => raw), now });
  const res = await flow.ingest({ title: 'synthetic eye', provenance: 'synthetic', text: EN_TEXT });
  assert.equal(res.mode, 'fallback');
  assert.equal(res.telemetry.modelCalls.length, 1);
  assert.deepEqual(res.telemetry.rawModelJson, raw);
  assert.equal(res.telemetry.validation.ok, false);
  assert.ok(Number.isInteger(res.telemetry.rejected));
});

test('telemetry on fallback without a model has no raw JSON and an English query default', async () => {
  const flow = createFlow({ llm: null, now });
  await flow.ingest({ title: 'synthetic eye', provenance: 'synthetic', text: EN_TEXT });
  const ans = await flow.query({ text: 'When is my eye appointment?' });
  assert.equal(ans.telemetry.rawModelJson, null);
  assert.equal(ans.telemetry.modelCalls.length, 0);
  assert.equal(ans.telemetry.validation.ok, false);
});

test('local calendar mode persists the confirmed event to the file and reads it back', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ebys-flow-cal-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const calendarFile = path.join(dir, 'calendar.json');
  const flow = createFlow({ llm: null, now, calendarMode: 'local', calendarFile });
  assert.equal(flow.runtime().calendar.kind, 'ebys_local');
  await flow.ingest({ title: 'synthetic clinic', provenance: 'synthetic', text: '딸: 엄마, 다음 주 화요일 오후 3시에 중앙병원 김 선생님 예약했어요.\n엄마: 그래, 알았다.' });
  const mem = flow.memories().memories.find((m) => m.kind === 'event');
  const p = flow.propose({ memoryId: mem.id });
  const id = p.id ?? p.proposal?.id;
  const pv = flow.preview({ proposalId: id });
  assert.ok(!pv.needs_clarification, 'explicit 오후 3시 should be exact');
  const rec = await flow.confirm({ proposalId: id, previewDigest: pv.previewDigest });
  assert.equal(rec.displayState, 'completed_external', JSON.stringify({ status: rec.status, verifyLevel: rec.verifyLevel, error: rec.error }));
  const stored = JSON.parse(await readFile(calendarFile, 'utf8'));
  assert.ok(JSON.stringify(stored).includes(pv.preview.fields?.startsAt ?? pv.preview.startsAt ?? '15:00'), 'event persisted with the confirmed time');
  const rb = await flow.readback(rec.recordId);
  assert.equal(rb.displayState, 'completed_external');
  assert.equal(flow.notifications().ok, true);
});

test('unknown calendar mode is refused instead of mislabelled', () => {
  assert.throws(() => createFlow({ llm: null, now, calendarMode: 'phone' }), /calendar mode/);
});

test('confirm is refused when the source memory was cancelled after proposing', async () => {
  const { flow, mem } = await flowWithEvent();
  const p = flow.propose({ memoryId: mem.id });
  const id = p.id ?? p.proposal?.id;
  const pv = flow.preview({ proposalId: id });
  flow.core._store.state.memories.get(mem.id).status = 'cancelled';
  const res = await flow.confirm({ proposalId: id, previewDigest: pv.previewDigest });
  assert.equal(res.ok, false);
  assert.ok(['source_changed', 'proposal_closed'].includes(res.error.code), res.error.code);
  assert.equal(flow.records().records.length, 0);
});
