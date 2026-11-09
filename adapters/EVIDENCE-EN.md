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

## calendar.local status (checked 2026-11-09 11:58)

Tested at unit level against a temp-dir JSON file. NOT wired into the running product: `server.mjs` does not reference `createActionService`, and `.data/calendar.json` does not exist because no server run has created one. Do not claim it works in the app until lead wires it and QA reads the file back.

Per-file tests: action-service 43, calendar-local 20, english 10, ics 6, safety 5 = 84 pass, 0 fail.
