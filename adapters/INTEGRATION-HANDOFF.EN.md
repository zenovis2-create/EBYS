# Adapters integration handoff (English-first)

Owner: sj-actions (`adapters/` only). Reader: Opus lead, who owns the `server.mjs` and `app/` wiring.
Status date: 2026-11-09. Everything below is verified at unit level against temp files. Nothing here is wired into the running server yet (`server.mjs` has no reference to `createActionService`).

## 0. What is real, and what is not

| Capability | Status | Truth |
|---|---|---|
| EBYS on-device calendar (`calendar.local`, JSON file) | demonstrated (unit tests, temp dir) | A file on the **server's** disk. Readback = re-reading that file. It is **not** the phone's calendar and not an OS calendar. |
| Reminder feed (`dueNotifications`) | demonstrated (unit tests) | The UI **polls** and shows reminders inside EBYS (`delivery: "in_app_poll"`). |
| OS / phone notifications | **not built, not claimed** | Windows toasts are disabled on this machine (see `AVAILABILITY.md`). No push, no service worker, no Android integration exists in this layer. |
| ICS handoff (`real:'ics'`) | demonstrated (unit tests) as a *file*; saving is unverifiable | Status stops at `handed_off`. The user opens the file and saves it. EBYS cannot see the phone calendar. Never `completed`. |
| Simulated (`mode:'simulated'`) | demonstrated (unit tests) | Always `completed` + `verifyLevel:'none'`. Writes nothing anywhere. |

Never show "added to your phone calendar" or "notification sent to your phone" anywhere. The words to use are in `record.readbackText` and `preview.modeLabel`; render those instead of writing your own.

## 1. Exports (`import ... from './adapters/index.mjs'`)

| Export | Use |
|---|---|
| `createActionService(opts)` | The service. See section 2. |
| `intentFromProposal(proposal, {sessionId})` | core `Proposal` -> `ActionIntent`. Pass `sessionId` so `purge({sessionId})` can find the record. |
| `computePreviewDigest`, `computePreviewDigestAsync`, `digestString` | Digest (node:crypto / browser WebCrypto). Equal output (tested). The browser variant imports `../contracts/contracts.js`, so serve that path if `ui/` imports `adapters/digest.mjs`. |
| `readbackText`, `displayDateTime`, `displayParts`, `localize`, `DEFAULT_LANG` | Copy and time helpers. `localize(obj, 'en'\|'ko')` picks a language from any `{ko,en}` object. |
| `buildIcs`, `parseIcs` | RFC 5545 builder/parser (used internally). |
| `createLocalCalendarAdapter`, `DEFAULT_CALENDAR_FILE`, `createSimulatedCalendarAdapter`, `createIcsHandoffAdapter`, `createNotificationPreview` | Adapters (only needed for custom wiring). |
| `FAULTS`, `VERSION` | Fault names for test mode; `actions-0.1.0`. |

## 2. Service API

```js
createActionService({
  now,              // () => ISO string | ms | Date. Inject for tests/demo. Default: a fixed demo time.
  mode,             // 'simulated' (default) | 'real'
  real,             // 'local' (default, EBYS file calendar) | 'ics'      (only used when mode==='real')
  calendarFile,     // path to the JSON file. Default: senior-jarvis/.data/calendar.json (not created until first write)
  fault, timeoutMs, slowMs, adapters   // test options
})
```

Throws if an adapter's mode does not match the service mode (mislabel guard).

| Method | Sync? | Returns |
|---|---|---|
| `preview(intent)` | sync, no side effects | Preview object, or `{needs_clarification:true, missing, reasons, prompt:{ko,en}}` |
| `confirm({intent, previewDigest, allowDuplicate?})` | async | ActionRecord, or `{ok:false, error:{code, message, retryable, phase, userHint:{ko,en}}}` |
| `readback(recordId)` | async | ActionRecord (re-checks the store; reconciles `unknown_outcome`) or `{ok:false,error}` |
| `cancel(recordId)` | async | ActionRecord (`cancelled`, only after verified removal) or the record with `error.code==='cancel_unconfirmed'` |
| `list()` | sync | ActionRecord[] (copies) |
| `purge({sessionId})` | sync | `{name:'action_ledger', status, detail, related:[...]}` receipt line. Omit `sessionId` to purge everything. |
| `describe()` | sync | RuntimeInfo: `defaultLang`, `timezone`, `calendar.kind`, `notifications.kind`, `faultInjection`, ... |
| `dueNotifications(at?, {since})` | sync | `{ok, source, now, notifications[], lastN}` |
| `getArtifact(recordId)` | sync | ICS file `{filename, mime, content}` only for `handed_off` records, else `null` |
| `setFault(f)` | sync | Test only. Labelled `TEST FAULT INJECTION` in `describe()`. |

### Preview payload (fields lead/UI will use)

```json
{
  "needs_clarification": false,
  "intentId": "p1", "revision": 1, "kind": "appointment",
  "adapterId": "calendar.local", "mode": "real",
  "previewDigest": "<sha256 hex>",
  "fields": { "title": "Dental check-up", "who": "Dr. Patel", "startsAt": "2026-11-12T15:30:00+09:00",
              "endsAt": "2026-11-12T16:30:00+09:00", "reminders": [60], "tz": "Asia/Seoul" },
  "display": {
    "when": { "en": "Thu, 12 Nov 2026, 3:30 PM (Seoul time, UTC+9)", "ko": "..." },
    "whenParts": { "iana": "Asia/Seoul", "zoneName": "...", "utcOffset": "+09:00", "utcLabel": "UTC+9",
                   "weekday": "...", "date": "...", "time12": "3:30 PM", "time24": "15:30" }
  },
  "summary": { "en": "Dental check-up with Dr. Patel - Thu, 12 Nov 2026, 3:30 PM (Seoul time, UTC+9)" },
  "modeLabel": { "en": "Saved to the EBYS calendar on this device (not your phone calendar)" },
  "warnings": [ { "code": "timezone_differs|in_past|place_unknown|person_unknown|ics_local_timezone", "message": { "en": "..." } } ],
  "notifications": [ "..in-app reminder previews, PREVIEW-badged.." ]
}
```

`previewDigest = sha256(canonicalJson({intentId, revision, kind, title, who, startEpoch, durationMin, where, reminders, adapterId, mode, tz}))`. Any change to those fields after the preview makes `confirm` return `stale_preview`.

### Record statuses and what to show

| `status` | `verifyLevel` | Meaning / what to show |
|---|---|---|
| `completed` | `api_readback` (local) / `none` (simulated) | Local: saved in the EBYS file and re-read. Simulated: show the simulation label, not a success tick. |
| `handed_off` | `handoff` | ICS file ready; user must save it. Not done. |
| `unknown_outcome` | `none` | Request may or may not have landed (`post_send`, timeout, `lost_response`, `api_500`, `readback_failed`). No blind retry. Offer **Check result** (calls `readback`). |
| `failed` / `permission_denied` | `none` | `pre_send`, nothing written. `error.retryable:true` -> same `confirm` again with the same digest. |
| `verify_mismatch` | `none` | The stored entry differs from what was asked (rolled back where possible), or it was edited/deleted behind our back. Tell the user not to rely on it. |
| `cancelled` | - | Only after verified removal (re-read). |

Always show `record.readbackText` (English first; `{ko,en}`) and `record.calendarLabel` rather than composing text.

## 3. Time and timezone rules

- All calendar times are stored and shown in **Asia/Seoul (+09:00)**, with the zone printed next to the time. The product is English, not US-timezone.
- `startIso` must be a full ISO datetime with an offset. Anything else (date only, "ambiguous", missing) -> `needs_clarification` with a per-case English prompt. The adapter never invents a time or guesses AM/PM.
- If `intent.when.tz` is not `Asia/Seoul`, preview adds a `timezone_differs` warning. The instant is preserved; only the displayed zone is stated.
- Reminder rules in the feed (source: bridge `server.js` L478-547): `reminderOffsetsMin` chosen by the user (default 30 min before when none), 08:00 for all-day events, 09:00 for tasks due that day, all Seoul time.

## 4. Notification feed

```js
// GET /api/notifications?since=N
const r = service.dueNotifications(undefined, { since: Number(req.query.since) || 0 });
// -> { ok, source: 'calendar.local', now, notifications: [...], lastN }
// client stores lastN and sends it as ?since= next poll
```

One notification:

```json
{ "n": 1, "type": "reminder", "source": "calendar.local", "mode": "real", "delivery": "in_app_poll",
  "label": { "en": "EBYS reminder (shown inside the app, not a phone notification)" },
  "uid": "sj-...@ebys.local", "intentId": "p1", "recordId": "act_...", "offsetMin": 60,
  "fireAt": "2026-11-12T14:30:00+09:00", "ts": "2026-11-12T14:31:00+09:00",
  "title": { "en": "3:30 PM Dental check-up" }, "body": { "en": "Starts in 1 hour · with Dr. Patel (Seoul time)" } }
```

- `dueNotifications` runs the reminder sweep each call. Each reminder fires once; after downtime only the nearest due one is emitted (no spam).
- Non-local adapters return `{source:'none', notifications:[]}`. Do not show a "reminders on" state for them.
- Pass a later `at` only for QA/demo ("advance the day"). Real use passes nothing.
- Render the `label` next to each item. Do not call these phone notifications.

## 5. Idempotency and readback

- Operation key `intentId:revision`. Same confirm again returns the same record with `deduplicated:true`. Entry uid is `sj-<sha256(intentId)[0..24]>@ebys.local`, so it survives a server restart (new service on the same file updates the same entry: tested).
- A newer revision of the same intent updates the same entry; older revisions then return `stale_preview`.
- `confirm` verifies by re-reading the file (not by trusting the write). A mismatch is rolled back and reported as `verify_mismatch`.
- `readback(recordId)` re-reads again, so tampering or deletion after confirm shows as `verify_mismatch` / `missing_on_readback`. It also settles `unknown_outcome` from the file: entry found -> `completed`; verified absent -> `failed` + retryable.
- A corrupt calendar file is an error and is never overwritten.

## 6. Failure map

| Fault / situation | Status | Phase | Retry |
|---|---|---|---|
| `permission_denied` (also real EACCES/EPERM/EROFS on the file) | `permission_denied` | pre_send | yes, same digest |
| `network`, storage error (cannot create dir / write) | `failed` | pre_send | yes, same digest |
| `timeout`, `api_500`, `lost_response`, readback error after write | `unknown_outcome` | post_send | no; `readback` first |
| `mismatch` | `verify_mismatch` | post_send | no |
| Details changed after preview | `{ok:false, error.code:'stale_preview'}` | - | re-run `preview` |
| Time/title missing or ambiguous | `needs_clarification` | - | ask `prompt` |
| Same person + time as another active record | `{ok:false, error.code:'duplicate'}` | - | `allowDuplicate:true` if the user insists |

Known copy gap (mine, not fixed yet): the `permission_denied` hint says "Allow it in settings". For `calendar.local` the cause is file permission on the server, not a phone setting. Treat the hint as generic until I reword it.

## 7. Wiring sketch for `server.mjs` (lead owns this; not applied)

```js
import { createActionService, intentFromProposal } from './adapters/index.mjs';
const actions = createActionService({ mode: 'real', real: 'local' });   // writes senior-jarvis/.data/calendar.json

// POST /api/actions/preview   { proposal, sessionId }
const intent = intentFromProposal(proposal, { sessionId });
res.json(actions.preview(intent));

// POST /api/actions/confirm   { proposal, sessionId, previewDigest }  (UI must have shown the preview first)
res.json(await actions.confirm({ intent: intentFromProposal(proposal, { sessionId }), previewDigest }));

// POST /api/actions/:id/readback  ->  await actions.readback(id)
// POST /api/actions/:id/cancel    ->  await actions.cancel(id)
// GET  /api/actions               ->  actions.list()
// GET  /api/notifications?since=N ->  actions.dueNotifications(undefined, { since })
// GET  /api/runtime               ->  include actions.describe()
// DELETE data / receipt           ->  actions.purge({ sessionId })   // receipt line name 'action_ledger'
```

Also needed from lead: add `.data/` to `.gitignore`; add `local_calendar` (and `notification_queue`) to `RECEIPT_STORES` (or accept them as `related` lines of `action_ledger`); quote the test glob in `package.json` (`"adapters/*.test.mjs"`, since `node --test adapters/` fails on Node 24).

## 8. Offline smoke example (isolated)

```
cd senior-jarvis
node adapters/smoke.example.mjs
```

- Each run uses its own `mkdtemp` directory and removes it afterwards. It refuses to run against `.data/`. No server, no network, no phone, no real recording, messages or emergency calls.
- 21 checks: describe, preview (zone shown, nothing written), confirm with file readback, idempotency (same service and after a simulated restart), `stale_preview`, `timezone_differs`, the notification feed with the `since` cursor, `lost_response` then readback, `permission_denied` then retry, tamper detection, purge receipt.
- The same function is run by `adapters/smoke.test.mjs`, which also asserts the shared `.data/calendar.json` was neither created nor removed.

## 9. Verified counts

Run from `senior-jarvis/`: `node --test "adapters/*.test.mjs"`.

| File | Tests |
|---|---|
| `action-service.test.mjs` | 43 |
| `calendar-local.test.mjs` | 20 |
| `english.test.mjs` | 10 |
| `ics.test.mjs` | 6 |
| `safety.test.mjs` | 5 |
| `smoke.test.mjs` | 1 |
| **Total** | **85** |

`node adapters/smoke.example.mjs` -> 21/21 checks passed.

Not covered here (QA/UI/core): live English model, real browser profile, voice, LAN phone access, any real OS or phone calendar/notification.
