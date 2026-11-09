# T21a: independent held-out API QA

QA-owned synthetic transcripts and answer keys. Do not use these as training/design fixtures or share their contents with sj-memory/sj-ui before the independent run. KO covers cancellation/supersession and changed place; EN covers unresolved AM/PM and unknown speaker. Both contain untrusted prompt injection. Each has three free-form questions, including one unanswerable. `../../test-plan.md` remains the broader acceptance reference.

From `senior-jarvis/`:

```
node --check qa/run-heldout.mjs
node --test qa/run-heldout.test.mjs
node qa/run-heldout.mjs
```

The runner never starts a server. It probes TCP 127.0.0.1:8787, then sends serial POSTs only to `/api/ingest` and `/api/query`. No server means BLOCKED and zero POSTs. It never follows HTTP redirects, calls action endpoints, resets shared state, retries ingestion after uncertain outcomes, or reads credentials. Each run saves request payloads, raw HTTP response text, timing, parsed responses, fixture/runner hashes and verdicts in `qa/evidence/<timestamp>-<pid>/report.json`. Exit codes: 0 PASS, 1 FAIL/error, 2 BLOCKED. A run can take several minutes with a slow model; per-request timeout is 180 seconds.

Requests follow CONTRACTS revision 2: ingest `{title,text,lang,provenance:'synthetic'}`, query `{text,lang}`. Responses may be the direct contract object or `{ok:true,data:...}`. Source citations must match the ingested utterance ID, exact quote and character offsets; quotes must also belong to the held-out transcript. Exact-time answers accept the declared KST ISO or its equivalent UTC ISO. The saved natural-language answer keys remain available for independent human review of unsupported prose, cancellation history and attribution.

Lead handoff requirement: to establish Track A evidence, include `mode`, `route:{id,model}`, `rejected`, `rawModelJson`, and `validation` in the ingest result or its `telemetry` object. Elapsed HTTP latency is captured independently. Missing fields or fallback produce BLOCKED for AI evidence, even if answer checks pass. This is a request for lead-owned observability, not a product change by QA. A server-supplied route label alone cannot prove a live provider call; lead must audit actual routing. Query responses are retained raw, but query-specific provider routing is not certified if absent.

These checks do not establish full release acceptance: injection non-execution needs action-ledger inspection, cancellation needs memory-history inspection, and UI/action/permission/privacy/notification behavior needs the later combined-flow test. Existing server state is preserved; questions name the held-out event/person, and citations from unrelated sessions fail. Synthetic sessions remain after testing. Repeating this run is not an idempotency test and may encounter server dedup/cache behavior, which must remain labelled.

Offline scoring: `node qa/score-heldout.mjs qa/evidence/<run>/report.json` writes `scored-report-v2.json` alongside the unchanged raw report. It includes exact HTTP/semantic/model-evidence scores and route ID, model, cached flag and latency per call. Version 2 fixes two QA representation assumptions: exact time may be `Slot.value.startIso`, and ambiguous time may retain a date/hour object with null exact time. Original verdicts are retained for audit. A fallback answer can pass correctness but does not count as a live-model answer. This scorer performs no network calls.
