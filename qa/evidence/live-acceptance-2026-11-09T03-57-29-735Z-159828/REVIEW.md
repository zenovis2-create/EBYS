# Clean sequential API acceptance: independent verdict

QA idle. One invocation each: `node qa/run-heldout.mjs`, then `node qa/run-english-first.mjs`, orchestrated by `qa/run-live-acceptance.mjs` with GET-only runtime brackets. No automatic QA retries, server controls, deletion, browser or action calls. Original raw responses and frozen answer keys are unchanged.

| Measured scope | Result |
| --- | --- |
| Held-out correctness | **5/6**: KO 3/3; EN 2/3 |
| English-first correctness | **2/3** questions; **4/5** source/value checks |
| Combined question correctness | **7/9**, all model-backed; no fallback credit |
| Absent-fact questions | **3/3 PASS**: KO bus route, EN unknown speaker, English-first kiln serial |
| HTTP model requests | **12/12 HTTP 200** |
| Raw model/validation/route consistency | **12/12 PASS**, three ingest evidence checks PASS |
| Route/cache | cursor-cli/claude-sonnet-5-5-low; **12/12 uncached**, zero fallback |

Exact per-request model ms, wall ms, validation/rejected counts and router call counts are in `independent-summary.json`; original model JSON remains in the two child reports. Validation completeness is not a semantic correctness pass.

## Remaining failures: known ambiguity collapsed to absent memory

1. **Held-out EN**: `What clock time can safely go on the seed-swap calendar entry?` Known conversation states 2027-02-16 at 7 and explicitly leaves morning/evening undecided. Expected: preserve known date/ambiguous hour with exact source and ask AM or PM. Observed: found=false, every slot unknown with empty evidence, no clarification, sentence `I don't have that in your conversations.` Raw model JSON's notFoundReason recognizes the event and unresolved AM/PM, but this explanation is not rendered as a clarification. Model ms=75501, uncached. Retain FAIL; no unsafe action was performed, but helpful clarification was lost.
2. **English-first**: `Before adding Rowan's plant swap, which part of the day does eight mean?` Rowan's utterance says `I also have a plant swap with Devin on 2027-03-12 at 8. We have not decided AM or PM.` Expected: preserve known context, ask AM/PM, never choose a time. Observed: same found=false/empty-slot/generic absent-memory result, no clarification. Raw notFoundReason additionally says nothing mentions a plant swap with Rowan despite Rowan being the speaker of `I also have...`. Model ms=22235, uncached. Retain FAIL; do not weaken the ambiguity oracle to accept a generic unavailable answer.

Revised appointment person/date/time/place answers and the three truly unavailable facts passed. The previous bus-route found=true case is fixed **for this observed KO held-out question**; this does not establish universal unknown/relevance correctness.

## Code/UI provenance

Loaded backend stayed at SHA256 `8c8e675399c3d4fe5470103e79bc281c1261f7818438eef9d223580ac6c6aeb6`, startedAt `2026-11-09T03:51:40.668Z`, runtime version actions-0.1.0. Before/after loaded hashes and start times match both runs: **no restart was observed**.

- Held-out: serverCurrent=true before and after. UI changed from `0844b682b2c64f321647ea753df670871184bb1da73d68f81ff3babe1b9f5703` to `9da18d8fb18afc906c89a653ff73cb1ac1ebd8c59dd577baf1fa7fbe4059cf1c` during the run, consistent with the announced redesign. Model/API scores are retained; a stable visual-build claim is not made.
- English-first: loaded backend unchanged, UI stable at `9da18d8f...`. At completion, serverOnDisk changed to `507d378e8bb948e87d26a0646b1ff033e0b3791f5fa88b085dd7763b9dedc649`, so serverCurrent=false. The wrapper's serverStable=false means current-disk/loaded alignment failed, **not that a restart occurred**. Results describe the still-loaded backend, not the newly edited on-disk core.
- English-default served HTML/i18n checks passed 2/2 in the English-first run; actual fresh-browser rendering, full redesign, accessibility, confirm/cancel/idempotency and real-local calendar readback remain outside this API run. Parent Aside retains visual E2E.

## Evidence paths

- Held-out: `qa/evidence/2026-11-09T03-57-29-839Z-60184/report.json`, `scored-report-v2.json`, `runtime-before.json`, `runtime-after.json`.
- English-first: `qa/evidence/english-first-2026-11-09T04-02-40-843Z-183348/report.json`, `runtime-before.json`, `runtime-after.json`.
- Sequence: this directory's `sequence.json` preserves child output/runtime captures; `independent-summary.json` gives combined verified counts and provenance.

Verdict: **API acceptance FAIL (two ambiguity cases); final/current-build provenance BLOCKED.** Telemetry is now present in independent QA calls, unlike older reports and the reduced capture summary. No further model calls until a lead-ready signal for any later targeted retest.
