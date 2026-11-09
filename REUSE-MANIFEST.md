# EBYS reuse manifest (baseline vs event-window work)

Event rule (EVENT-RULES-LATEST.md): forks of existing projects are allowed; only NEW development is judged. This file records exactly what came from existing user-owned Jarvis projects and what is new. Status vocabulary: `inspected` (read only, nothing copied) < `copied` < `adapted` < `tested` (fresh EBYS test output recorded here). Inspected is NOT reuse.

All sources are the owner's own local projects. Sources were read only; nothing in them was modified, restarted or reconfigured. No secrets, tokens, device lists, life-log data, audit logs or model provider keys were copied (`token.txt`, `devices.json`, `lifelog/`, `audit.log`, `models.json` explicitly excluded).

## Sources inspected (10:38-10:45 KST)
| Source | Revision | Language | Verdict for EBYS |
|---|---|---|---|
| `E:\jarvis-aside-bridge` | not a git repo; `server.js` mtime 2026-11-08 15:45 (sha256 recorded on copy) | Node ESM-free CommonJS-style single file + `index.html` | **Most reusable.** Has 2-hour life-log digest prompt + validation, voice intent classifier, local calendar/task store with atomic writes and reminder sweep, STT client + Whisper hallucination filter, ko-KR TTS. |
| `E:\Jarvis` | git `5240b20` (dirty Android files, not touched) | Python coordinator, Kotlin Android probe, TS contracts | Foundation (pairing/auth/events/leases). Too heavy to port in the window; no model/voice runtime implemented (README says so). Inspected only. |
| `E:\Jarvis-Mobile` | git repo, same README as `E:\Jarvis` | same | Appears to be a copy of `E:\Jarvis`. Inspected only. |
| `E:\jarvis-memory` | git repo | Python stdlib | Evidence-ID task candidates, deletion with secure_delete, 07:00 briefing. Concepts (stable evidence IDs, deletion of bundles containing deleted evidence) inform core design; no code ported (language mismatch). Inspected only. |

## Component map (source -> target)
| # | Source component | Target in EBYS | Owner | Status | Change vs baseline |
|---|---|---|---|---|---|
| R1 | bridge `digestBlock` 2-hour summary prompt + item validation (`server.js` ~L341-406) | `core/` `summarizeWindow` + extraction prompt basis | sj-memory | assigned 10:45 | EBYS adds verbatim evidence verification, unknown/ambiguous slots, no "1-7시 = 오후" default (review R05), supersede/negation handling, senior-specific wording |
| R2 | bridge `classifyIntent` (L408-434) | `core/` request classifier for spoken/typed asks (event / task / question) | sj-memory | assigned 10:45 | EBYS routes "question" to evidence-linked recall instead of a generic agent |
| R3 | bridge `parseModelJson` (L353-357) | `llm/router.mjs` `extractJson` | lead | adapted, not copied: equivalent fenced/bracket extraction written independently; `<think>` stripping added 11:25 after inspecting the bridge. No dedicated unit test yet; exercised by live ingest 11:05 | |
| R4 | bridge calendar store `cleanEvent/cleanTask/calAddEvent/calAddTask`, atomic tmp+rename, reminder sweep (L478-547) | `adapters/` `calendar.local` (real local EBYS calendar with file readback) + reminder sweep | sj-actions | assigned 10:45 | EBYS adds preview digest binding, idempotent confirm, phase-aware failures, deletion receipt participation |
| R5 | bridge `transcribe` STT client + `HALLU` filter (L323-339) | voice input route (stretch) | lead | inspected; STT service is another project's shared service on gdx-1, availability not checked | only after a read-only health check and owner OK |
| R6 | bridge `speak()` ko-KR `speechSynthesis` (index.html L487) | `ui/` read-aloud | sj-ui | assigned 10:45 | |
| R7 | bridge Android hybrid `mirrorToPhone` / `N.deletePhoneEvent` phone-calendar mirror (index.html ~L997-1095) | roadmap note | lead | inspected; requires the native Android hybrid app (not located/installed in this window) | not claimed |

## New in the event window (10:00-15:00 KST, 2026-11-09)
Everything under `senior-jarvis/` was created today: contracts, llm router (cursor-cli route verified 10:08), core memory/extraction/recall/supersede/dedup/delete, adapters ledger/preview/confirm/ICS, senior mobile UI, QA held-out scenarios, presentation mockup. Adapted pieces above are marked per file in this table when they land, with source sha256.

## Validation evidence
(filled as components land: command, output summary, timestamp). Owner clarification: adapt and integrate Jarvis core for older adults, not a literal unchanged copy. "Inspected" or "assigned" is never reported as adapted or tested.

| Component | Status 11:35 | Exact evidence |
|---|---|---|
| R1 summarizeWindow | exists in core; bridge lineage not proven | independent audit REPORT.md: present, SIMULATED CLOCK, no 2h scheduler |
| R2 classifyRequest | in progress (sj-memory) | not yet in a passing test |
| R3 extractJson | adapted | `POST /api/ingest` 11:05, `mode=model`, 40.6 s, 1 memory / 8 verbatim quotes |
| R4 calendar.local | not implemented | adapters are in-memory simulated + ICS only (audit) |
| R5 STT | inspected only | not used |
| R6 speak() | not found in ui (audit) | none |
| R7 Android mirror | roadmap | none |
| Lead confirm guard (new) | new in event window | `node --test "app/*.test.mjs"` 2/2 pass, 11:28 |
