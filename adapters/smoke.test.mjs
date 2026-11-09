import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { runSmoke } from './smoke.example.mjs';
import { DEFAULT_CALENDAR_FILE } from './index.mjs';
import { fileURLToPath } from 'node:url';

test('offline smoke example passes end to end in an isolated temp dir', async () => {
  const sharedBefore = existsSync(fileURLToPath(DEFAULT_CALENDAR_FILE));
  const r = await runSmoke();
  const failed = r.checks.filter((c) => !c.ok);
  assert.deepEqual(failed, [], 'failing smoke checks');
  assert.ok(r.checks.length >= 20);
  assert.equal(existsSync(r.dir), false, 'temp dir is removed');
  assert.equal(existsSync(fileURLToPath(DEFAULT_CALENDAR_FILE)), sharedBefore, 'the shared .data/calendar.json was neither created nor removed');
});
