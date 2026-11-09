// Offline smoke example for the EBYS-local calendar + in-app notification feed. Owner: sj-actions.
//
//   node adapters/smoke.example.mjs        (from senior-jarvis/)
//
// Isolation: every run creates its own temp directory and writes ONLY there. It refuses to run against
// senior-jarvis/.data. No server, no network, no phone, no OS notification, synthetic data only.
// The same function is imported by smoke.test.mjs, so the example is verified in CI-style runs.
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createActionService, intentFromProposal, DEFAULT_CALENDAR_FILE } from './index.mjs';

// the service API is confirm({ intent, previewDigest }); this helper keeps the call sites short
const confirmWith = (svc, intent, previewDigest) => svc.confirm({ intent, previewDigest });
const CLOCK = '2026-11-09T10:30:00+09:00'; // fixed "now" so the output is repeatable

/** A synthetic core Proposal (shape from CONTRACTS section 4). Not a real person. */
const proposal = ({ id = 'prop_smoke_1', fields = {} } = {}) => ({
  id, revision: 1, state: 'proposed', missing: [],
  slotUncertainty: { when: 'stated', who: 'stated' },
  evidence: [],
  fields: { kind: 'appointment', title: 'Dental check-up', who: 'Dr. Patel', where: 'Riverside Clinic',
    startsAt: '2026-11-12T15:30:00+09:00', remindOffsetsMin: [60], ...fields },
});

/**
 * @param {{ log?: (s:string)=>void, keep?: boolean }} [o]
 * @returns {Promise<{ ok:boolean, checks:{name:string, ok:boolean, detail?:any}[], dir:string }>}
 */
export async function runSmoke({ log = () => {}, keep = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ebys-smoke-'));
  const file = join(dir, 'calendar.json');
  const checks = [];
  const check = (name, ok, detail) => { checks.push({ name, ok: !!ok, detail }); log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : '  ' + JSON.stringify(detail)}`); };

  // Isolation guard: never touch the shared app data folder.
  const shared = resolve(fileURLToPath(DEFAULT_CALENDAR_FILE));
  if (resolve(file) === shared || resolve(file).startsWith(resolve(shared, '..') + sep)) throw new Error('refusing to run against the shared .data folder');

  try {
    const mk = () => createActionService({ now: () => CLOCK, mode: 'real', real: 'local', calendarFile: file });
    let svc = mk();

    // 1. describe(): what the UI may claim
    const d = svc.describe();
    check('describe: English default, Seoul zone', d.defaultLang === 'en' && d.timezone.iana === 'Asia/Seoul', { lang: d.defaultLang, tz: d.timezone.utcOffset });
    check('describe: calendar is EBYS-local, notifications are in-app poll (not OS)', d.calendar.kind === 'ebys_local' && d.notifications.kind === 'in_app_poll', { calendar: d.calendar.kind, notifications: d.notifications.kind });

    // 2. proposal -> intent -> preview (nothing is written yet)
    const intent = intentFromProposal(proposal(), { sessionId: 'smoke-session' });
    const p = svc.preview(intent);
    check('preview: exact time shown with zone', p.display.whenParts.utcLabel === 'UTC+9' && /Seoul time/.test(p.display.when.en), p.display.when.en);
    check('preview: says EBYS calendar, not the phone calendar', /not your phone calendar/.test(p.modeLabel.en), p.modeLabel.en);
    check('preview: writes nothing', !existsSync(file));

    // 3. confirm with the digest -> write -> re-read the file
    const rec = await svc.confirm({ intent, previewDigest: p.previewDigest });
    check('confirm: completed + real + api_readback', rec.status === 'completed' && rec.mode === 'real' && rec.verifyLevel === 'api_readback', { status: rec.status, verifyLevel: rec.verifyLevel });
    const onDisk = JSON.parse(readFileSync(file, 'utf8'));
    check('file: one event on disk, in the temp dir only', onDisk.events.length === 1 && onDisk.events[0].startsAt === '2026-11-12T15:30:00+09:00', onDisk.events[0]?.startsAt);
    check('readbackText is English and names the zone', /read back to check/.test(rec.readbackText.en) && /Seoul time, UTC\+9/.test(rec.readbackText.en), rec.readbackText.en);

    // 4. idempotency: same confirm again, then again from a NEW service (server restart)
    const again = await svc.confirm({ intent, previewDigest: p.previewDigest });
    check('idempotent: second confirm is deduplicated, same record', again.deduplicated === true && again.recordId === rec.recordId);
    svc = mk();
    const afterRestart = await svc.confirm({ intent, previewDigest: svc.preview(intent).previewDigest });
    check('idempotent across restart: still exactly one event', afterRestart.status === 'completed' && JSON.parse(readFileSync(file, 'utf8')).events.length === 1);

    // 5. stale preview: details changed after the preview was shown
    const edited = { ...intent, title: 'Dental cleaning' };
    const stale = await confirmWith(svc, edited, p.previewDigest);
    check('stale_preview: changed details are rejected, not saved', stale.ok === false && stale.error.code === 'stale_preview', stale.error?.userHint?.en);

    // 6. timezone is shown, never silently reinterpreted
    const ny = svc.preview({ ...intent, when: { ...intent.when, tz: 'America/New_York' } });
    check('timezone_differs warning for a non-Seoul zone', ny.warnings.some((w) => w.code === 'timezone_differs'), ny.warnings.find((w) => w.code === 'timezone_differs')?.message.en);

    // 7. notification feed (in-app poll). Advance the injected time to 14:31 on the day (reminder was 60 min before 15:30).
    const early = svc.dueNotifications('2026-11-12T13:00:00+09:00');
    check('feed: nothing before the reminder time', early.ok && early.notifications.length === 0 && early.source === 'calendar.local');
    const due = svc.dueNotifications('2026-11-12T14:31:00+09:00', { since: 0 });
    check('feed: reminder appears once, labelled as in-app', due.ok && due.notifications.length === 1 && /not a phone notification/.test(due.notifications[0].label?.en ?? ''),
      due.notifications[0] && { title: due.notifications[0].title?.en, body: due.notifications[0].body?.en, n: due.notifications[0].n });
    const next = svc.dueNotifications('2026-11-12T14:31:00+09:00', { since: due.lastN });
    check('feed: polling again with since=lastN returns nothing new', next.ok && next.notifications.length === 0);

    // 8. failure: lost response after send => unknown_outcome, then readback reconciles from the file
    const i2 = intentFromProposal(proposal({ id: 'prop_smoke_2', fields: { title: 'Pharmacy pick-up', who: 'Mina', where: 'Corner Pharmacy', startsAt: '2026-11-13T11:00:00+09:00', remindOffsetsMin: [] } }), { sessionId: 'smoke-session' });
    svc.setFault({ type: 'lost_response', times: 1 });
    const lost = await confirmWith(svc, i2, svc.preview(i2).previewDigest);
    check('lost_response: unknown_outcome, never shown as success', lost.status === 'unknown_outcome' && lost.error.phase === 'post_send' && lost.error.retryable === false, lost.error?.userHint?.en);
    const rec2 = await svc.readback(lost.recordId);
    check('readback reconciles: file has the entry => completed, one write', rec2.status === 'completed' && rec2.verifyLevel === 'api_readback' && JSON.parse(readFileSync(file, 'utf8')).events.length === 2);

    // 9. failure: permission denied before send => nothing written, retry with the same digest works
    const i3 = intentFromProposal(proposal({ id: 'prop_smoke_3', fields: { title: 'Library visit', who: 'Ana', startsAt: '2026-11-14T10:00:00+09:00', remindOffsetsMin: [] } }), { sessionId: 'smoke-session' });
    const d3 = svc.preview(i3).previewDigest;
    svc.setFault({ type: 'permission_denied', times: 1 });
    const denied = await confirmWith(svc, i3, d3);
    check('permission_denied: shown as denied, nothing written', denied.status === 'permission_denied' && denied.error.retryable === true && JSON.parse(readFileSync(file, 'utf8')).events.length === 2, denied.error?.userHint?.en);
    const retried = await confirmWith(svc, i3, d3);
    check('retry (same digest) after pre_send failure completes', retried.status === 'completed' && JSON.parse(readFileSync(file, 'utf8')).events.length === 3);

    // 10. tampering is detected on readback
    const c = JSON.parse(readFileSync(file, 'utf8'));
    c.events[0].startsAt = '2026-11-13T16:00:00+09:00'; c.events[0].start = '2026-11-13T16:00';
    const { writeFileSync } = await import('node:fs');
    writeFileSync(file, JSON.stringify(c));
    const tampered = await svc.readback(rec.recordId);
    check('readback: edited file is verify_mismatch, not done', tampered.status === 'verify_mismatch', tampered.error?.mismatch);

    // 11. purge: deletion receipt line
    const receipt = svc.purge({ sessionId: 'smoke-session' });
    const rest = JSON.parse(readFileSync(file, 'utf8'));
    check('purge: action_ledger receipt, calendar re-read shows nothing left', receipt.name === 'action_ledger' && receipt.status === 'verified_deleted' && rest.events.length === 0,
      receipt.related.map((r) => `${r.name}:${r.status}`));
  } finally {
    if (!keep) rmSync(dir, { recursive: true, force: true });
  }
  return { ok: checks.every((x) => x.ok), checks, dir };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const r = await runSmoke({ log: (s) => console.log(s) });
  console.log(`\n${r.checks.filter((x) => x.ok).length}/${r.checks.length} checks passed (temp dir removed: ${r.dir})`);
  process.exitCode = r.ok ? 0 : 1;
}
