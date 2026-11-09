# Final English acceptance and receipt

Status: **PREPARED, NOT RELEASE-ACCEPTED**. sj-qa owns `qa/` only. Parent Aside owns all browser/visual E2E; this plan neither requests Chrome access nor bypasses its rejection. No server restart/deleteAll, shared-state reset, external calls/messages or new expensive model calls during preparation. Live work waits for core/UI readiness and the lead's explicit ready/reload signal.

The receipt validates the **full English + EBYS-local calendar** claim. If only a simulated result or ICS/labelled preview exists, retain those honest labels and leave local-calendar acceptance BLOCKED. A preview can be presented within its declared scope; it cannot satisfy a real-local save claim. No phone/OS/cloud calendar or OS notification claim follows from local JSON/in-app polling.

## Owner readiness / dispatch order

| Owner | Required handoff before final acceptance | Current knowledge, not a new approval |
| --- | --- | --- |
| sj-memory | GAP1 value-to-quote binding; GAP2 source cancellation invalidation; bus-route/unknown relevance fix; changed files/hashes and offline results | Last independent held-out: 5/6; KO bus-route FAIL. No final patched live rerun yet. |
| sj-ui / Opus UI | English-default copy and live services; GAP3 object dates/candidates; focus/390px/zoom/motion changes and hashes | Parent's `BROWSER-ENGLISH-VERIFIED.md` reports English default in sample mode; not full live proof. |
| sj-actions | calendar.local integration contract, English errors/readback, actual runtime mode, local store scope, cancel/reconcile and notification limits | `adapters/EVIDENCE-EN.md` is unit evidence; does not itself prove the running app uses the local adapter. |
| senior-planner | Collect owner-ready reports, reload once, publish ready signal + runtime/sourceSnapshot/version, reserve serial model lane | No reload or model lane acquisition by QA. Server-loaded hash must match disk after owner patches. |
| sj-qa | Independent offline GAP12 and receipt checks; after ready signal collect raw held-out model responses with runtime brackets | Prepare now; do not reinterpret historical missing telemetry as present. |
| parent Aside | Fresh isolated browser context, actual live UI flow, raw screenshots/video/network trace and visual verdict | Sole visual E2E owner. Copy approved evidence into project artifact paths with hashes. No shared-browser storage reset. |
| independent reviewer / lead | Review completed receipt and unresolved claims; keep maker/checker separate | No automatic publication, account integration or release authorization from a validator PASS. |

Ready sequence: core + UI + actions handoffs -> lead reload/ready and model lane -> independent live QA -> **QA idle** -> parent visual run on the same stable build -> independent receipt review. If server code/UI changes or reload occurs during evidence collection, re-bracket the affected run; don't combine old API evidence with new screenshots as one run.

## Required gates (PASS / FAIL / BLOCKED / NOT_RUN)

| Receipt gate | Exact acceptance and evidence |
| --- | --- |
| EN_DEFAULT | Fresh isolated storage; canonical `/` redirecting to `/?api=live`, or explicit `/ui/?api=live`, without `lang=en` or a manual toggle. Record navigator locale (including Korean-locale check), rendered English labels, optional KO toggle, URL and actual parent capture. A manual English switch and source-only default inspection are separate evidence. |
| EN_FLOW_COPY_VOICE | Parent reviews natural English input, recall, source drawer, clarification, confirm/readback, date/time **and visible timezone**, errors and accessibility labels. Text always usable. Voice/ASR is `unverified`, `unsupported` or `device-tested`; en-US source mapping is not recorded speech proof. No new recording for QA prep. |
| LIVE_EN_HELDOUT | New arbitrary synthetic English transcript from QA; ingest plus at least 3 free-form questions (one unanswerable). Verbatim quote/offset/utterance checks and expected answer checks all pass. Save raw model JSON, validation `{ok,rejected,reason?}`, result/telemetry mode, modelCalls, route `{id,model,cached,ms}`, wall latency and rejected count. Fresh extraction must be uncached; query caches must be explicit. |
| UNKNOWN_RELEVANCE | Ask an absent fact such as a bus route: unknown/found=false. Relevant surrounding names/place cannot count as an answer. Neither a real quote nor telemetry validation proves relevance. No invented speaker, missing slot or action. |
| GAP12_SYNTHETIC | `node --test --test-reporter=tap acceptance-123/audit.test.mjs`: exact **12 tests / 12 pass / 0 fail**, includes GAP-1 and GAP-2. Label SYNTHETIC-FAKE-LLM; counts prove code invariants only. Preserve any failures and hashes. Never add these 12 to live question scores. |
| GAP3_OBJECT_CANDIDATE | Capture actual core object candidates `{date,time,startIso,...}` (not only fixture strings); UI retains date, shows alternatives, initially leaves AM/PM unselected and requires explicit choice before confirm. English labels and selected instant match raw object payload. Legacy string support is a separate regression. |
| CONFIRM_BINDING | English person/date/time/timezone/place/action/reminders readback; explicit confirmation bound to current proposal revision and preview digest/adapter/mode. Editing invalidates old consent. A conversation agreement is not confirmation. |
| LOCAL_CALENDAR_READBACK | Runtime uses calendar.local; action is `mode=real`, `status=completed`, `verifyLevel=api_readback`. Save exact expected fields, action record and **fresh disk-read snapshot**; title/start/person/place/reminders agree, including wall-time alias and timezone. Read only the run's synthetic event. UI says EBYS calendar on this device; no phone calendar/OS toast claim. |
| CANCEL_IDEMPOTENCY | Cancel this run's proposal/source; stale confirm rejected and no write. Repeat confirmation for same intent/revision returns same record, no duplicate writes. If separately testing removal after local save, read back absence and no pending reminders. Never cancel another worker's event or use deleteAll as cleanup. |
| ERROR_HONESTY | Isolated synthetic permission/pre-send failure, post-send timeout/unknown outcome and mismatch traces. No success copy on failure; only pre-send retry, post-send retry disabled until readback/reconciliation. Fault scope must be agreed with lead; no global shared fault changes during others' runs. |
| MOBILE_390 | Parent's actual 390 CSS px viewport: Input, Memory, Ask, Clarify, Confirm, Result, Plans, Privacy and Error. Record scrollWidth/clientWidth per screen and screenshot; no horizontal overflow/clipped control. This is a browser viewport result, not a physical-phone test. |
| KEYBOARD_TARGETS_ZOOM | Logical keyboard path, visible focus, dialog focus return, measured critical targets at least 44x44 CSS px (prefer 48 for seniors), 150% and 200% zoom/text enlargement without clipping/hidden confirm/cancel. Actual measurements, not CSS declarations. |
| REDUCED_MOTION | Parent enables prefers-reduced-motion, records nonessential movement disabled while progress/status remain usable. No screenshot-only inference of animation behavior. |
| RAW_CAPTURE | Parent Aside raw actual-app screenshots/video plus raw API capture, stable run ID/URL/timestamps, producer and SHA256. No mockup/fixture footage as live proof, generated screens, cropped-away simulation labels or unlabelled voice. Hashes establish identity; a human still judges what the media shows. |

## Receipt protocol and validator

Copy `final-en-receipt.template.json` to a new `qa/evidence/<final-run>/receipt.json`. All initial gates are NOT_RUN; the template intentionally returns BLOCKED. Keep original reports untouched. Per PASS gate add `reviewedBy` (different from maker `owner`), `evidence` artifact IDs, and `details` below. `independentReviewer` must differ from `preparedBy`.

Artifacts map: `{ "id": {"path":"qa/evidence/<run>/file.json", "sha256":"<64 hex>", "kind":"json|tap|text|image|video", "producer":"sj-qa|parent-Aside|..."} }`. Paths are project-relative; no outside paths, symlink escapes or dependency/build directories. Stage parent-approved capture copies under the project. File hashes and basic raw media signatures are checked; pixels, video truth and human wording are **not** automatically certified.

- `runtime.before` / `runtime.after`: distinct JSON artifact IDs, each `{capturedAt,httpStatus,body:<raw /api/runtime response>}`. Require stable `version`, serverLoaded.startedAt/hash, serverOnDisk hash, serverCurrent=true, and stable uiOnDisk hash. Captures must bracket the independent live report's startedAt/completedAt. Snapshots identify the served build; filenames or an old runtime version alone do not.
- `live.report`: QA-produced `run-heldout.mjs` report artifact; `live.scenarioIds` lists English scenario IDs. Validator independently reads response telemetry and answer/source expectations. Lead smoke calls, fake LLM, fallback, absent raw JSON or missing validation cannot substitute. Capture runtime before/after only after the lead ready signal; existing runner doesn't add those captures itself.
- Details keys for EN_DEFAULT: `freshStorage,manualToggle,renderedLang,optionalKo,navigatorLocale,url,apiMode`. EN_FLOW_COPY_VOICE: `naturalEnglishReviewed,textAlternative,capabilityLabelsHonest,timezoneVisible,voiceStatus`.
- GAP12_SYNTHETIC: `tapArtifact,modelKind:'synthetic-fake-llm'`. GAP3: `candidateArtifact,candidatePointer` (JSON pointer to raw object candidates), `selectedIso,datePreserved,ampmInitiallyUnselected,explicitChoice`.
- CONFIRM_BINDING: `digestBound,revisionBound,editRevokesConfirmation,consequentialReadbackEnglish`. LOCAL_CALENDAR_READBACK: `recordArtifact,diskArtifact,expected:{title,startsAt,who,where,reminders},phoneCalendarClaim:false,notificationClaim:'in-app-only'`.
- CANCEL_IDEMPOTENCY: `staleConfirmRejected,duplicateWrites:0,sameRecordOnDuplicate,cancelledEntryAbsentOnReadback,cancelledReminderCount:0`. ERROR_HONESTY: `permissionFailureNoSuccess,preSendRetryOnly,postSendRetryDisabled,reconciliationRequired,mismatchNoSuccess`.
- MOBILE_390: `viewport:{width:390,height:...},overflow:[{screen,scrollWidth,clientWidth},...]`. KEYBOARD_TARGETS_ZOOM: `keyboardFlow,focusVisible,dialogFocusRestored,minTargetWidth,minTargetHeight,zoom150,zoom200,zoomNoClipping`. REDUCED_MOTION: `prefersReducedMotion,nonessentialMotionDisabled,progressStillUsable`.
- RAW_CAPTURE: `producer:'parent-Aside',raw:true,mockup:false,linkedRunId:<receipt runId>,apiMode:'live'`; evidence must include actual image/video bytes and parent review. Boolean observations still require the named human review and linked raw evidence.

From `senior-jarvis/` (offline only):

```
node --check qa/validate-final-en-receipt.mjs
node --test qa/final-en-receipt.test.mjs
node qa/validate-final-en-receipt.mjs qa/final-en-receipt.template.json
node qa/validate-final-en-receipt.mjs qa/evidence/<final-run>/receipt.json
```

Exit 0 PASS = complete receipt for declared scope, not publication permission; 1 FAIL = contradictory/invalid/hash-mismatched or explicitly failing evidence; 2 BLOCKED = missing/not-run gates or final reviewer. No HTTP, model, browser or action execution occurs in this validator. Latest historical live QA remains 5/6 overall (EN 3/3); the lead-produced telemetry audit is 5/5 completeness only. Neither makes this new final receipt ready.

## Preparation evidence (offline only)

`evidence/final-en-prep-2026-11-09/gap12-synthetic.tap` records an independent fresh **12/12 PASS** of the synthetic GAP suite during preparation; this supersedes the old 10/12 baseline only at the tested code state. It is not a live or loaded-server result and must be re-linked/rechecked after final owner changes. `validator-selftests.tap` separately records receipt-checker tests using synthetic in-memory metadata/media. The blank receipt remains BLOCKED; no product claim is inferred from either test count. Readiness callbacks and the parent Aside visual receipt are still pending; none were sent through external messaging by QA.
