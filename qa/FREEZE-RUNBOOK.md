# Frozen runtime QA: prepared, not executed

Owner sj-qa; files under qa/ only. Await the user's exact **LEAD-READY-FREEZE <server sha12> <ui sha12>** message. Do not derive a signal from on-disk files or old runtime records. Parent Aside owns browser/visual E2E. No live requests, model calls, cleanup or server controls during preparation.

After signal, execute once from senior-jarvis:

```
node qa/run-freeze-qa.mjs --signal "LEAD-READY-FREEZE ACTUALSERVER12 ACTUALUIHASH12"
```

The actual arguments must be the supplied 12-hex hashes. Preparation only: `node qa/run-freeze-qa.mjs --plan`; offline guards: `node --test qa/freeze-policy.test.mjs`.

Scope: the two fixed AM/PM questions plus the three absent-fact regressions, source/value binding, ambiguous-confirm refusal, cancelled/stale-preview refusal, idempotent valid confirmation, independent 2:30 PM calendar.local file + GET readback. No broad full-suite/live reruns, other users' proposals or extra model retries. Expected model budget is nine serial requests: four ingests and five questions. Stop starting model calls when fewer than five minutes remain before 14:45 KST, reserving a 180-second request timeout and two minutes for cleanup. Non-model requests are bounded by the remaining absolute deadline. Scope remains API/local-file, not phone calendar or visual release acceptance.

Evidence: full raw HTTP request/response bodies, actual rawModelJson/validation/modelCalls/route/cache/ms, exact source quotes/offsets, file-event projection, action records, before/after GET /api/runtime sourceSnapshot (loaded hash/start time, disk/current flag, UI hash, version), and every session deletion receipt. Hashes and startedAt must match the signalled runtime throughout. No new expensive calls if freeze changes; still attempt safe cleanup on the same loaded backend.

Session ownership: unique run titles; register only returned session IDs with duplicate=false and matching utterance session IDs in this exact run. Never clean IDs from historical QA files after a reload. POST /api/delete payload is **only `{sessionId}`**, one per owned synthetic session; all:true/all:false/extra keys are refused. A restarted backend invalidates old-ID cleanup authority. Cleanup is capture hygiene, not permission to clear shared stores.

If the same session ID already belongs to a baseline persistent calendar event, deletion is blocked: an in-memory ID reused after reload does not authorize deleting that older event. Record the ownership collision and report FAIL rather than broadening cleanup. Unconfirmed own proposals whose deterministic UID collides with an old file event are cancelled and reallocated with a bounded eight-attempt cap, before any confirmation/refusal probe; old events are never overwritten to make a test pass.

At completion, independently inspect remaining memories, action records and local calendar file for this run's memory/record/UID identifiers; check unrelated baseline items remain unchanged. Keep receipts and failures, even if a receipt says allVerified=true. Do not claim full deletion if a store is not_verified or own objects remain. No direct .data edits, no global purge, no cleanup of others' sessions. Synthetic local events are removed only through authorized own-session deletion.

Current source follow-ups before freeze (read-only observation; lead owns fixes):

- app/flow intentFor still reads Memory.sessionId while actual memory stores meta.sessionId. Prior independent file event had sessionId=null. Per-session action/file cleanup may therefore miss it.
- core.finishReceipt uses named purgers for each receipt store, while current flow registers action_ledger and llm_cache only; action-service's related local-calendar/notification statuses are not flattened by finishReceipt. Missing registered receipt stores become not_verified. Do not paper over this with a QA all-delete or a fake successful receipt.

Final message only after requests and cleanup finish: **QA idle PASS** or **QA idle FAIL**, plus evidence path and any remaining owned IDs. A FAIL is not capture approval. Lead captures on the same loaded server afterward; no QA restart, UI edits or Chrome access bypass.
