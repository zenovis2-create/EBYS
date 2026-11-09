# EBYS capture handoff (Windows -> Mac), lead senior-planner, 2026-11-09 11:35 KST

Contract: `../../MEDIA-HANDOFF-CONTRACT.md`, `../../MAC-MEDIA-STATUS.md`. Mac root `/Users/a123/projects/ebys-media` (watcher PID 90210, polls every 30 s, stops at 14:30 KST). The parent transfers files from this folder to the Mac inbox, assets first and `manifest.json` last. Windows never edits the Mac project.

## Status 14:15: NO capture is approved for Mac assembly. Do not transfer v2.
v2 below was taken while sj-ui was still editing `ui/` (not a frozen runtime), and its `api-telemetry.json` holds summary flags only (not the raw request/response/validation objects). It does show the PRIMARY icon (derived `ebys-icon-96/512.png`; `ui/assets/ebys-icon-original.png` is byte-identical to the owner's file, sha256 `f8c27768…`), but that is not yet the UI READY build. The final capture follows the runtime freeze: sj-ui UI READY + core READY, then one lead server reload, a QA idle targeted retest with before/after serverCurrent/UI hashes, and then a fresh capture with raw API objects. v2 is kept as a rehearsal only.

## v2 rehearsal (14:06 KST), NOT approved: new brand UI in progress + EBYS local calendar
Folder: `ebys-live-en-2026-11-09T05-03-42-589Z/`. Transfer the `.mp4`, `api-telemetry.json`, `timeline.json` and `checks-summary.json` first, then `manifest.json` last. `REJECTED-*` folders are never deliverable (`REJECTED-ebys-live-en-2026-11-09T05-00-52-643Z` stopped at the new home screen before any API call).

- Video: 109.47 s, 780x1688 (390x844 CSS @2x, portrait), 30 fps H.264, no audio, sha256 `abeed4018ed3467d038decf60c7e40d30024e2cb489b385d78e70907675effb7` (re-hashed and matches the manifest).
- Code alignment: `serverCurrent=true`; server sha `16614e36d095…`, ui sha `a0a28dd4b882…` (sj-ui's redesign working tree, in progress); `buildCommit` `0f46a7b` with a dirty working tree (the redesign `ui/` is not committed yet). Tests on that disk state: `npm test` 220/220, audit 12/12. Server started 14:00 with `EBYS_CALENDAR=local`.
- Model evidence (`api-telemetry.json`): `/api/ingest` and `/api/query` both `mode=model`, `cursor-cli/claude-sonnet-5-5-low`, `cached=false`, raw JSON present, `validation.ok=true`. `/api/confirm` gave `displayState=completed_external` (written to the EBYS local calendar file and read back).
- Timeline (seconds): app open 1.8 -> home "Add a memory" 4.5 -> conversation entered 7.0 -> model extraction 7.9–48.2 (wait) -> evidence drawer 51.9 -> question 57.0 -> model query 57.0–89.1 (wait) -> answer with sources + AM/PM kept open 93.2 -> proposal "Not saved yet" 95.7 -> AM/PM clarify 95.7 -> user picks PM 99.2 -> confirmation card 102.9 -> result "Saved in the EBYS calendar on this device and read back to check … 2:00 PM (Seoul time, UTC+9)" 106.6 -> end 108.1. The editor may cut the two model waits but must show them as cuts, not speed them up and present them as instant.
- Manifest claims (from this run's checks): English default; real model extraction + recall; verbatim source evidence; AM/PM clarification with explicit user choice; confirmation before action; "Saved to the EBYS calendar on this device and read back (local file; not the phone calendar, no phone notification)" verified; watch/24h audio/glasses/safety/119 roadmap.
- Narration/caption rules for the calendar beat: say "saved to EBYS's own calendar on this device and checked", never "added to your phone calendar" and never "you'll get a phone notification".
- Known content limits: the proposal names Tom (who relayed the change) as the person; it is the model's reading and is shown as such. 2:00 PM comes from the user's PM choice for the source's "Thursday at 2", not from a guess. The unanswerable-question behaviour is QA-verified (targeted retest 3/3) but is not shown in this footage.

## Superseded: v1 (12:40 KST), old UI and simulated calendar; keep only as a fallback
Folder: `ebys-live-en-2026-11-09T03-38-19-926Z/`. Transfer the `.mp4`, `api-telemetry.json`, `timeline.json` and `checks-summary.json` first, then `manifest.json` last. Nothing else in `media-outbox/` is deliverable (`tools/` is the capture script; `staging/` is empty).

- Video: 96.47 s, 780x1688 (390x844 CSS @2x, portrait), 30 fps H.264, no audio, sha256 `0e278a761bcb88050961aba035408b621e3f9188774170d7f34121402517c727` (re-hashed and matches the manifest).
- How it was made: `node media-outbox/tools/capture-live-en.mjs` drives the real app at `http://127.0.0.1:8787/?api=live` in headless Chrome with a fresh profile. Only page pixels are recorded (no desktop, other windows or notifications). No `?lang=` is passed, so English is the fresh-profile default.
- Code alignment: `sourceSnapshot.serverCurrent=true` at capture; server code sha256 `c8ff215a8c8c…`, ui sha256 `d048feb88fce…` (full hashes in the manifest). Core at that point passed `node --test core/*.test.mjs` 54/54 and `acceptance-123/audit.test.mjs` 12/12. No git commit existed at capture time (`buildCommit: null`). The first commit, `6a2d4f1` (12:58), came after it and includes later core fixes; a recapture on the redesigned UI will cite its commit.
- Model evidence (`api-telemetry.json`): `/api/ingest` and `/api/query` both returned `mode=model`, `cursor-cli/claude-sonnet-5-5-low`, `cached=false`, `rawModelJson` present, `validation.ok=true`. `/api/confirm` returned `displayState=simulated_completed`.
- Timeline (`timeline.json`, seconds): app open 1.7 -> conversation entered 4.2 -> model extraction 5.1–36.6 (wait) -> evidence drawer 40.4 -> question asked 45.5 -> model query 45.5–75.9 (wait) -> answer with sources + "AM or PM?" 79.9 -> proposal not yet saved 82.4 -> AM/PM clarify 82.5 -> user picks PM 86.0 -> confirmation card 89.7 -> labelled simulated result 93.3 -> end 94.8. The editor may cut the two model waits, but must show them as a cut and must not speed them up and present them as instant.
- Visible honesty labels in footage: "Live AI", "Microphone off · only text you paste is read", "Inferred"/"Ambiguous" badges, "Simulation only: nothing will be saved to your phone or calendar", "never makes real calls … or calls 119", explicit "Seoul time, UTC+9".
- Known content limits: "Who: Tom, Martha" is shown as *Inferred* (the model's guess, labelled as such). The unanswerable-question fix is not in this footage and is not claimed. The in-app wait text says "10 to 40 seconds", but real waits were about 31 s each here (copy fix requested from sj-ui).

## What will be captured (actual app, synthetic data only)
- Source: `http://127.0.0.1:8787/?api=live`, served by `senior-jarvis/server.mjs`, model route `cursor-cli/claude-sonnet-5-5-low`, calendar mode `simulated`.
- Input: a NEW synthetic English conversation (not the fixtures and not QA's held-out text), labelled SYNTHETIC on screen.
- Sequence: problem -> source conversation -> ask who/when -> evidence + unknown/AM-PM clarification -> explicit user choice -> confirmation card -> labelled SIMULATED calendar preview (or verified action only if calendar.local passes readback tests) -> benefit.
- Model latency (~30–60 s per call) is either shown honestly or cut with a visible "model processing" cut marker. Cached replays are labelled `cached`.

## Manifest fields (schemaVersion 1)
project=EBYS, buildCommit, appUrl, capturedAt, sourceMachine, captureType, relativeFile, sha256, durationSeconds, width, height, fps, audioPresent, syntheticData=true, containsPersonalData=false, featureClaims[{name, status: verified|simulated|roadmap, evidence}], rightsNotes.

## Feature claims allowed today (update only from evidence)
v1 manifest claims (generated from this run's checks): English default verified; real model extraction + recall verified; verbatim source evidence verified; AM/PM clarification with explicit user choice verified; confirmation before action verified; calendar action simulated; watch/24h audio/glasses/safety/119 roadmap.

| Feature | Status | Evidence |
|---|---|---|
| Model-backed extraction on new text | verified (KO + EN) | QA english-first 02-26-00 (3/3), QA rerun 02-43-28 (EN 3/3); lead `evidence/lead-live-en-2026-11-09T03-00-24-767Z.json` |
| Source-linked recall (verbatim quotes) | verified (KO + EN) | same reports |
| Unknown instead of invented answer | verified (QA targeted 3/3, 13:48) | `qa/evidence/targeted-local-2026-11-09T04-42-20-836Z-180200/report.json`; not in v2 footage |
| Runtime/code alignment | available | `/api/runtime` `sourceSnapshot.serverCurrent` + `uiOnDisk.sha256` recorded per capture |
| AM/PM clarification, no default | verified (QA targeted 2/2; v2 footage) | same QA report; v2 `timeline.json` checks |
| Confirmation before action | verified (v2 footage; QA local checks) | v2 `timeline.json`; QA report |
| Calendar save | verified as the EBYS calendar on this device (a local file, read back); NOT the phone calendar, and no phone notifications | v2 `api-telemetry.json`; QA local checks 18/18; `evidence/lead-calendar-local-2026-11-09T04-28-35-405Z.json` |
| Watch, 24h audio, glasses, safety/119 | roadmap | no implementation |

Forbidden in footage: real personal data, real recordings, real 119 calls, any implied validated safety service, an ICS handoff presented as a calendar save, Korean footage presented as English-native proof.
