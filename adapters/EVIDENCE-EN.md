# English-first evidence: adapters layer (sj-actions)

Scope: unit-level only. No live model, no real browser, no voice, no phone. Those belong to QA, ui and core.

Run (from `senior-jarvis/`): `node --test "adapters/*.test.mjs"` -> tests 84, pass 84, fail 0.

| Claim | Evidence | Status |
|---|---|---|
| Default language is English | `describe().defaultLang === 'en'`; `DEFAULT_LANG='en'`; every copy object is `{ko,en}`, English first | demonstrated (unit) |
| English copy for English input has no Hangul, no snake_case or internal-code leaks | `english.test.mjs` scans every preview, record, readback, hint and prompt across all scenarios | demonstrated (unit) |
| Date, time and timezone always explicit | `display.whenParts` and `displayDateTime`, e.g. "Thu, 12 Nov 2026, 3:30 PM (Seoul time, UTC+9)" | demonstrated (unit) |
| No silent locale reinterpretation | A differing intent tz gives a `timezone_differs` warning; ICS gives `ics_local_timezone`; fixed zone is Asia/Seoul | demonstrated (unit) |
| Clarification prompts per precision (date-only, ambiguous, unknown, title) | exact strings asserted | demonstrated (unit) |
| EBYS-local calendar vs phone/OS notifications is stated | modeLabel "Saved to the EBYS calendar on this device (not your phone calendar)"; reminders are shown inside the app, not as phone notifications | demonstrated (unit) |
| Korean still available | `ko` strings are retained in every copy object | demonstrated (unit) |
| Live EN model, fresh browser profile, voice | Not tested here | unverified (QA) |

## calendar.local status (updated 2026-11-09 13:16; replaces the 11:58 "not wired" note)

**Wired.** `server.mjs` creates the flow with `EBYS_CALENDAR` (`local` for the real calendar); `app/flow.mjs` calls `createActionService` and `intentFromProposal`. Routes `GET /api/readback/:recordId` and `GET /api/notifications?since=` exist. Wiring is lead's work; the adapters are mine.

**Live evidence (lead's run):** `evidence/lead-calendar-local-2026-11-09T04-12-15-270Z.json` (captured 13:12 KST, server in local mode, synthetic text, model route cursor-cli).

| Claim | What that evidence shows | Status |
|---|---|---|
| Preview names the zone and the EBYS calendar | `Thu, 12 Nov 2026, 2:00 PM (Seoul time, UTC+9)`; modeLabel "Saved to the EBYS calendar on this device (not your phone calendar)" | demonstrated (live) |
| Confirm writes the file and re-reads it | `/api/confirm` -> `completed`, `verifyLevel: api_readback`, `displayState: completed_external` | demonstrated (live) |
| Readback re-checks | `GET /api/readback/act_2011784d585f` -> same status and level | demonstrated (live) |
| `.data/calendar.json` written | I read it (read-only) at 13:16: 1 event, `startsAt 2026-11-12T14:00:00+09:00`, uid `sj-...@ebys.local`, `intentId prop_1`, reminders `[60]` | demonstrated (live) |
| In-app reminder feed | `/api/notifications?since=0` -> `source: calendar.local`, `notifications: []`. Correct, because the run time (13:12 on 9 Nov) is before the 12 Nov reminder. No live reminder was ever shown. | **unverified live** (unit-tested only) |
| OS / phone notification | none sent, none built | not claimed |

**Scope caveats:**
- The evidence file's `calendarFile.matchedEvent` is `null` even though `eventCount` is 1 and the event is in the file. That is the evidence script's matching, not an adapter fault. Don't cite `matchedEvent` as a pass.
- The 2:00 PM time was wrong. The speakers said 2:30 PM, and core's merge reduced it to 14:00. The adapter stored and read back exactly what it was shown, so `api_readback` proves "the file matches the preview", not "the preview matches what was said". The earlier stage (sj-memory) is responsible for that.
- The unit-level claims in the table at the top still stand and are separate from this live run.

Per-file unit tests (from `senior-jarvis/`, `node --test "adapters/*.test.mjs"`): action-service 43, calendar-local 20, english 10, ics 6, safety 5, smoke 1 = 85 pass, 0 fail.
