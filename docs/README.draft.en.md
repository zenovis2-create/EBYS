# EBYS — README draft (English)

**DRAFT.** Not the repository README. Do not replace `senior-jarvis/core/README.md`, `senior-jarvis/qa/README.md`, or any README another owner already has. Do not publish or push. The submission form has not arrived.

EBYS is a mobile-first memory for conversations. Paste synthetic text, ask who or when, read the source line, then confirm or cancel a plan.

## Run

From `senior-jarvis/`, with Node.js 24 or newer:

```bash
node --check server.mjs
npm test
npm start
```

The server listens on `http://127.0.0.1:8787` unless `EBYS_HOST` or `EBYS_PORT` is set. The calendar mode defaults to `simulated`. Set `EBYS_CALENDAR=local` only when you mean the EBYS file calendar on this computer (`.data/calendar.json`), not the phone operating system.

Open the URL on the same machine. Pasted text for a live question must be synthetic, or you must already have consent. Sample buttons are sample mode. They are not live model calls.

`npm test` is the local check named in `package.json`. This draft does not record a fresh pass or fail.

## What you are looking at

| Label on screen or in the API | Meaning |
| --- | --- |
| Live model route | The server asked Cursor CLI. Recorded English checks used that route. A slow answer is still an answer. |
| Sample · not real AI | Fixture path. Synthetic script. No model call. |
| Source line | The quote the answer is tied to. No quote, no fact. |
| Confirm / Cancel | Confirm stores the plan in the selected calendar mode. Cancel drops that proposal. |
| Simulated calendar | In-app only. |
| EBYS calendar on this device | A JSON file on this computer. Not iOS or Android Calendar. |
| Handed off (`.ics`) | A calendar file was written for a person to import. Import on a phone was not verified. |
| Simulated (watch, 24h, safety) | Mockup. Not a device and not an emergency service. |

## Known limits

- Live queries and strict telemetry are different. Some responses include route, model, cache, milliseconds, raw model JSON, and validation. The lead file `evidence/lead-live-en-2026-11-09T03-00-24-767Z.json` was audited as five passing telemetry calls. Earlier QA reports were blocked when those fields were absent. Do not claim every run has strict telemetry.
- Default calendar is simulated. The local EBYS calendar is a file on this PC. Neither one is the phone OS calendar.
- Opus 5.5 is still redesigning the English UI. Treat current screens as in progress.
- No voice capture, no 24-hour recording, no watch, no 119, no health claim, no users, and no revenue in this build.
- Demo data stays synthetic.

Submission wording lives in `SUBMISSION-COPY-EN.md` in this same folder. Both files are drafts.
