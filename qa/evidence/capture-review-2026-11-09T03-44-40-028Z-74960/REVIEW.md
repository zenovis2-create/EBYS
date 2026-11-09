# Independent review of the 12:38 English app capture

Reviewer: sj-qa. Producer: senior-planner. Source package: `media-outbox/ebys-live-en-2026-11-09T03-38-19-926Z/`. **PARTIAL evidence accepted; complete model/raw evidence and final readiness remain BLOCKED.** No product/media source files were changed. QA performed file/media analysis and nine GET-only checks; zero new model/action calls, browser control, server restart or deletion.

## Independently measured

- Original MP4 SHA256 matches manifest: `0e278a761bcb88050961aba035408b621e3f9188774170d7f34121402517c727`. Full ffmpeg decode succeeds without errors.
- ffprobe: H.264, 780x1688, 30 fps, **96.466667 seconds**, no audio. Dimensions/fps/duration/audio agree with manifest. This is raw footage, not a <=90-second final submission export.
- Nine GET-only checks: **9/9 PASS**. `/`, `/app.js`, `/styles.css`, `/ui/app.js` and `/api/runtime` returned 200; `/ui/test/ui.test.mjs`, `/ui/tools/smoke.browser.mjs`, `/server.mjs`, `/core/core.mjs` returned 404. This verifies tested routing, not all possible static paths or module execution in a fresh browser.
- Twelve PNG frames were extracted unchanged from the submitted video and visually inspected. Filenames identify MP4 timestamps; the producer's timeline starts before the first screenshot, so event labels/times are not exact MP4 seek positions. This is sampled-frame review plus full media decode, not a new browser/device test or complete animation audit.

## Visible observations

| Observation | Independent evidence / limit |
| --- | --- |
| English UI | `opening-2.5s.png`, `source-4.5s.png`: English input/navigation/privacy labels, Live AI chip and microphone-off copy. Fresh profile/no language toggle is producer-reported and corroborated by capture code's fresh temp profile and no toggle call; QA did not independently execute a fresh browser. Producer used en-US locale, not a Korean-locale default test. |
| Source quote | `evidence-41.2s.png`: Priya, “The book club moved from Wednesday to Thursday at 2.” It is an exact substring of `timeline.json`'s transcript and visibly highlighted. Original EvidenceRef IDs/offsets and model output were not preserved in this package, so full source/value binding cannot be checked. |
| Ambiguity | `memory-38.5s.png`, `detail-76.5s.png`: Thursday Nov 12, 2:00 with AM/PM unresolved, an Ambiguous badge and “Is that AM or PM?” |
| Explicit PM selection | `clarify-83.6s.png`: AM/PM buttons unselected; `detail-84.8s.png`: PM selected with a checkmark, hour 2/minute 00. This supports the visible selection flow, not the raw object-candidate payload or every confirm guard. |
| Proposal/readback | `answer-80.5s.png` actually shows a proposal (filename is a seek hint, not a screen assertion): “Not saved yet. This is only a suggestion.” `choice-87.5s.png` / `detail-88.5s.png` show person/place/date/time/action text and simulation notice. The readback still ends “(needs more info)” despite a displayed exact PM time: visible copy inconsistency for UI/core owners to review. |
| Honest simulated action | `confirm-90.5s.png` / `result-94.3s.png`: simulated result styling, Seoul time UTC+9, notification preview and synthetic-data disclaimer. `api-telemetry.json` reports preview/confirm mode=simulated and displayState=simulated_completed. No actual local/phone calendar save is established. |

## Blocking evidence gaps

1. **Actual raw model JSON and validation objects are absent: 0/2 complete model records.** `api-telemetry.json` is only 842 bytes and contains summary booleans `rawModelJsonPresent:true` / `validationOk:true`, not the underlying objects, modelCalls, rejected counts, utterances or request/response bodies. Route summaries are internally plausible **2/2** (cursor-cli/claude-sonnet-5-5-low, cached=false, 31518/30392 ms), but these flags cannot pass the independent raw-evidence check. Producer checks 7/7 are producer assertions, not seven independent QA passes.
2. Capture exporter source confirms the loss: `media-outbox/tools/capture-live-en.mjs` retains response bodies in `apiCalls` in memory, then serializes a reduced `.map()` with presence flags. Raw frames/profile are deleted by the producer after encoding. No alternate raw response file is listed in this completed package. Lead should preserve request/response bodies and full telemetry before reduction on a future approved capture; QA did not edit or rerun the exporter.
3. **Build provenance is only a capture-start snapshot.** Manifest serverLoaded/serverOnDisk match `c8ff215a8c8c3f16a0e4e54d12f8302bfdcd41f91ba1beb319a74deaddc7eac1`, with uiOnDisk `d048feb88fce4a955d0caad4ebb4ae619d24a8fa15ad922b70e15626986228c6`. No after-capture runtime/version bracket is stored.
4. At QA GET time (see exact timestamps/raw response in `review.json`), runtime version was actions-0.1.0. Loaded server still matched the capture, but serverOnDisk was `de1eb40b1f79a5490918f00f43694f36922ac9230540718bca34cd2532aa7bee`, **serverCurrent=false**, and uiOnDisk was `0844b682b2c64f321647ea753df670871184bb1da73d68f81ff3babe1b9f5703`. Current code/UI differs from the archived capture. This does not retroactively invalidate its historical pixels; it prevents certifying it as the current final build.
5. One producer scenario and one question are not the independent held-out suite. The transcript repeats the earlier lead book-club scenario. Unknown/bus-route relevance, stale cancellation, duplicate confirm, permissions/errors, disk readback, object-candidate payload, measured 390px overflow, focus/targets, zoom/reduced motion, voice and physical-device behavior are not established by this package.

Disposition: retain as **English actual-app visual footage with a clearly simulated action**. Do not promote its manifest's raw-model verification claim to an independent AI-evidence or full release acceptance. Parent Aside still owns visual E2E. Mac must separately validate its edited <=90-second final output. Await stable owner patches and coordinated lead ready/reload signal before collecting any new live evidence.

Files here: `review.json` (raw collection, input hashes, probe/decode metadata, nine raw GET responses and API gap checks), twelve extracted PNGs, and this independent review. Original `media-outbox/` package is unchanged.
