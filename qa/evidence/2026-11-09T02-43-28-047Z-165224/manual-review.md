# Independent held-out rerun handoff

QA idle: runner completed at 2026-11-09 11:51:21 KST. No requests remain in flight. No server restart, reset/delete, action or confirmation calls were made by QA. Product files and fixture answer keys are unchanged.

Evidence: `report.json` contains original raw responses; `scored-report-v2.json` contains exact scores and route/model/cached/ms per call. Current runner/evaluator SHA256: `f4fcca03f6fd5c8e0fff682ec141f01ce9aff9cc7d8272c986cfc7353a2e9bee`. This run already used the corrected evaluator; offline scoring changed no verdicts.

| Measure | Result |
| --- | --- |
| HTTP ingest | 2/2, both model-backed, rejected=0 |
| HTTP query | 6/6 |
| Query correctness | 5/6 (KO 2/3; EN 3/3) |
| Correct model-backed queries | 4/6; one additional correct answer used fallback |
| Complete model evidence | 0/2 ingest checks; BLOCKED on missing rawModelJson/validation |
| Reported uncached cursor-cli calls | 7/8 requests; claude-sonnet-5-5-low, cached=false |

## Confirmed failure: KO unanswerable question

Reproduction uses the unchanged held-out KO transcript and query: `도담 씨가 낭독 연습에 갈 때 타기로 한 버스의 노선 번호가 무엇인가요?` No bus route appears in the transcript.

Expected: unavailable/unknown, no claim that the bus-route question was answered.

Observed: HTTP 200, mode=model, found=true, sentence `무엇: 낭독 연습 (변경)` / `What: Reading practice (rescheduled)`. All four slots contain known event context. The source quotes are valid for that unrelated event; they do not answer the bus-route question. This is a relevance/unknown failure, not a fabricated numeric bus route. Route: cursor-cli/claude-sonnet-5-5-low, cached=false, model ms=81577. Preserve FAIL; do not weaken the unknown oracle or edit product code in QA.

## Other observations and limits

- KO revised-date was correct through labelled fallback after `timeout: no model answer within 90000 ms`; HTTP elapsed=90226 ms. The client timeout was 180 seconds, so raising the client timeout would not fix this server/model deadline. No live-model correctness credit for that answer.
- EN ingest and all three EN answers used the real reported model route without fallback: model ms=65280 / 32769 / 70670 / 49074 respectively. Participant, AM/PM ambiguity with clarification and unknown speaker all passed value/source checks.
- All seven reported cursor-cli calls were uncached. No EPERM or transport error was observed in this run; this does not prove all future concurrency races are eliminated.
- Missing raw model JSON and validation telemetry remain explicitly BLOCKED, as the lead anticipated. Route reporting and raw HTTP output do not substitute for those fields.
- Calls explicitly supplied lang, so omit-lang inference was not exercised. UI English default, fresh browser/storage, voice, accessibility, confirmation/actions and stale-confirm cancellation were not retested or certified.
- Await a new lead assignment/fix ping for any targeted retest. No automatic extra model calls were sent.
