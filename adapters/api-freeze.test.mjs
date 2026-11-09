// Freeze test: the app (app/flow.mjs, server.mjs) depends on these signatures and shapes.
// If this test fails, tell lead BEFORE changing them. Uses a temp dir only; never touches senior-jarvis/.data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createActionService, intentFromProposal } from './index.mjs';

const NOW = '2026-11-09T10:30:00+09:00';
const proposal = () => ({
  id: 'prop_freeze', revision: 1, state: 'proposed', missing: [], evidence: [],
  slotUncertainty: { when: 'stated', who: 'stated' },
  fields: { kind: 'appointment', title: 'Dental check-up', who: 'Dr. Patel', where: 'Riverside Clinic', startsAt: '2026-11-12T15:30:00+09:00', remindOffsetsMin: [60] },
});

test('createActionService({ now, mode, real, calendarFile, adapters }) keeps its public surface', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'ebys-freeze-')), 'calendar.json');
  const svc = createActionService({ now: () => NOW, mode: 'real', real: 'local', calendarFile: file, adapters: {} });
  for (const m of ['preview', 'confirm', 'readback', 'cancel', 'list', 'purge', 'describe', 'dueNotifications', 'getArtifact', 'setFault']) {
    assert.equal(typeof svc[m], 'function', `service.${m} must stay a function`);
  }
  assert.equal(svc.preview.length, 1);          // preview(intent)
  assert.equal(svc.dueNotifications.length, 1); // dueNotifications(at, { since } = {}): `at` is the only non-default parameter

  const d = svc.describe();
  for (const k of ['data', 'defaultLang', 'timezone', 'calendar', 'notifications', 'mode', 'version', 'adapters', 'faultInjection']) assert.ok(k in d, `describe().${k}`);

  const intent = intentFromProposal(proposal(), { sessionId: 's1' });
  const p = svc.preview(intent);
  assert.equal(typeof p.previewDigest, 'string');
  assert.ok(!existsSync(file), 'preview writes nothing');

  const rec = await svc.confirm({ intent, previewDigest: p.previewDigest });
  assert.equal(rec.status, 'completed');
  assert.equal(rec.verifyLevel, 'api_readback');
  assert.equal(rec.readback.startsAt, '2026-11-12T15:30:00+09:00');
  assert.equal(typeof rec.readbackText.en, 'string');
  assert.equal(typeof rec.readbackText.ko, 'string');
  assert.equal(typeof rec.calendarLabel.en, 'string');
  assert.equal(typeof rec.recordId, 'string');

  const rb = await svc.readback(rec.recordId);
  assert.equal(rb.verifyLevel, 'api_readback');
  assert.equal(rb.readback.startsAt, '2026-11-12T15:30:00+09:00');
  assert.ok(rb.readbackText && rb.calendarLabel);

  const feed = svc.dueNotifications(undefined, { since: 0 });
  for (const k of ['ok', 'source', 'now', 'notifications', 'lastN']) assert.ok(k in feed, `dueNotifications().${k}`);
  assert.ok(Array.isArray(feed.notifications));

  const receipt = svc.purge({ sessionId: 's1' });
  assert.equal(receipt.name, 'action_ledger');
  assert.ok(['status', 'detail', 'related'].every((k) => k in receipt));
});
