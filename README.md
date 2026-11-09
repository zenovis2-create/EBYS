# EBYS · Ever by your side

EBYS is a mobile-first memory for conversations, built for older adults. Paste a conversation, ask who, when or where, and see the exact source line behind every answer. Nothing becomes a plan until you confirm it.

Built at c0mpiled-17 (Seoul, 2026-11-09, 10:00–15:00 KST). Demo data is synthetic.

## Run

From this folder, with Node.js 24 or newer (no dependencies to install):

```bash
npm test
npm start
```

Open `http://127.0.0.1:8787/`. A bare `/` redirects to `/?api=live`, which is the live, model-backed app. `/?api=fixture` is the offline sample mode, and it does not call a model. `EBYS_HOST` and `EBYS_PORT` change the address. The calendar mode defaults to `simulated`.

The live route asks the locally installed, already signed-in Cursor CLI in read-only ask mode (`llm/router.mjs`). Each model call takes about 20–70 s. When no model answers, EBYS falls back to labelled rules and says so.

## What you are looking at

| Label | Meaning |
| --- | --- |
| Live AI | The answer came from a real model call. `/api/ingest` and `/api/query` return `telemetry` with route, model, cache flag, latency, raw model JSON and validation. |
| Sample · not real AI | Fixture path: a synthetic script with no model call. |
| Source | The verbatim quote the answer is tied to. No quote means no fact. |
| Inferred / Ambiguous | The model's guess, or a time that still needs AM/PM. EBYS asks; it never picks for you. |
| Confirm / Cancel | Confirm sends only the exact details you reviewed. If the source conversation was cancelled or changed, confirm is refused. |
| Simulated calendar | In-app only. Nothing is saved to your phone. |
| Watch, 24h audio, glasses, safety | Roadmap. Not built. EBYS never calls 119. |

## Layout

| Path | Owner role | What |
| --- | --- | --- |
| `core/` | memory/core | extraction, recall, supersede/cancel, proposals, deletion |
| `adapters/` | actions | previews, confirm ledger, simulated calendar, ICS handoff |
| `ui/` | UI | mobile web app (ES modules, no framework) |
| `app/`, `server.mjs`, `llm/`, `contracts/` | lead | integration, HTTP server, model route, shared contracts |
| `qa/`, `acceptance-123/` | independent QA/audit | held-out and English-first live evaluations, regression audit |
| `evidence/`, `media-outbox/` | lead | live-run evidence, real-app capture tooling and handoff |

## Evidence (live model, synthetic data)

- `evidence/lead-live-en-2026-11-09T03-51-56-985Z.json`: a new English conversation, 5 calls, all `mode=model`, uncached, validation OK. "What is the bus route to the cafe?" returns *I don't have that in your conversations.*
- `qa/evidence/`: QA's held-out and English-first runs, with their own verdicts.
- Tests at 12:51 KST: `node --test "core/*.test.mjs"` 60/60, `npm run test:audit` 12/12, `node --test app/flow.test.mjs` 4/4.

## Provenance

The event rules allow forks and score only new work. `REUSE-MANIFEST.md` lists which ideas were adapted from the team's earlier Jarvis prototypes (inspected read-only; no secrets or personal data copied) and what was built during the event window. Commits in this repository begin on 2026-11-09.

## Known limits

- The UI is being redesigned during the event, so screens may change.
- Model latency is real, and the UI shows the wait.
- No voice capture, 24-hour recording, watch, emergency calling or health claims in this build.
