# core/ (owner: sj-memory) - source-linked conversation memory

Pure ESM, zero dependencies. `createCore({ now, store?, llm, purgers?, llmTimeoutMs? })` (see `core.mjs`).

Run tests (Node 24 needs a glob, a bare directory argument fails):

    node --test "core/**/*.test.mjs"

Dev smoke through the real model route on NEW synthetic text (spawns the authenticated cursor CLI, 25-60 s per call, cache off):

    node core/live-smoke.mjs        # set SJ_ROOT to the approved root

## What the model does vs what code does
- Model (1 `generateJson` call per ingest, 1 per query): reads the transcript, returns JSON mentions with verbatim quotes and cue labels (`propose|agree|replace|negation_unavailable|cancel`), and answers free-form who/when/what/where questions by choosing memory ids.
- Code: schema validation, `isVerbatim` quote check (item dropped + counted in `rejected`), KO/EN date and time normalization against injected `now()` in Asia/Seoul (`time.mjs`, AM/PM unresolved => `ambiguous`), negation/cancel/supersede/dedup state machines, proposals, deletion with receipts, summary.
- Fallback (`fallback.mjs`, `mode:'fallback'`): shallow rules, used ONLY when the model call fails or returns invalid JSON. UI must show "FALLBACK: no model". Query fallback is keyword search (`fallbackNote`).

## Result shapes (extras beyond CONTRACTS section 4 are additive)
- `ingestText` -> `{ ok, sessionId, utterances, memoriesCreated:number, memoryIds, merged, superseded, retracted, cancelled, unresolved, needsUserDecision, rejected:number, rejectedDetail, route:{id,model,cached,ms}, mode, fallbackReason? , duplicate? }` or `{ ok:false, error }`.
- `query` -> `{ found, sentence:{ko,en}, slots, clarification?, notFoundReason?, notFoundCode?, mode, route, caveats[], memoryId, matches[] }`. Sentence is composed in code from evidence-verified slots; the model's prose is never shown as an answer.
- `Memory.meta` (extra): `{ sessionId, cue, agreement:'none|proposed|agreed', corroborations, whenParts, history, pending, pendingUpdateOf?, constraint?:'unavailable', confirmed }`.
- Constraint "Friday no longer works" is stored as `kind:'fact'`, `meta.constraint:'unavailable'` and retracts open items on that date; it never becomes an appointment.
- A confirmed (`user_confirmed`) memory is never silently changed: a conversation change becomes `needsUserDecision` + `meta.pending`.
- Deletion: any memory with evidence from a deleted session is removed (conservative); statuses that depended on a deleted correction revert; proposals referencing removed memories are removed; search index rebuilt; `llm_cache` purged through `llm.purgeCache(arg)`; non-core stores come from `purgers`.

## English-first (owner update 11:20)
- Prompts (`prompts.mjs`) are English; transcripts may be English, Korean or mixed; quotes stay in the transcript's own language; `question` hints are written in the language of the lines they are about. Defaults: `query({lang})` and `classifyRequest(text,{lang})` default to `'en'`; a session's language is `ko` only when the text is Korean; unknown speakers are labelled `Unknown speaker` (`Unknown speaker 2`).
- `time.mjs` reads English phrases: weekdays, `next/this week Wednesday`, `the 15th`, `Monday the 16th` (mismatch => ambiguous), `in two days`, `this evening`, word numbers (`at six`, `two thirty`, `half past two`, `quarter to five`), `10 in the morning`. A bare hour is never defaulted to AM/PM.
- The labelled fallback (`fallback.mjs`) and the fallback request classifier have English cues (negation `can't make it / no longer works / unavailable`, cancel `is off / cancel / call it off`, move `push/move/shift ... to`, agree, task cues, English places/names). A change of place/person that states no time keeps the original (possibly ambiguous) time as an inferred slot.

## Source binding and action gates
- GAP1: a model-supplied `who`/`where` value must be bound to its quote (substring ignoring case/punctuation, or every substantial token present); a `when` slot is read from the QUOTE, the model's wording is ignored. On mismatch the slot stays `unknown`, `rejectedSlots[]` + caveat `model_value_not_in_source` are returned, and a clarification is offered (`notFoundCode:'unverified_model_value'`).
- GAP2: a proposal is valid only while its source memory is. Ingest/deletion/`resolvePending` re-sync proposals: a cancelled/superseded/retracted/deleted source EXPIRES the proposal (`meta.expiredReason`, `meta.supersededBy`); a changed or pending source sets `meta.stale`. `markConfirmed` and the new `validateForExecution(id)` re-check the source and refuse with code `source_changed` (`error.reason` = `source_cancelled|source_superseded|source_retracted|source_deleted|source_change_pending|source_changed`) or `not_confirmed`. `propose(memoryId)` again refreshes a changed proposal and drops the old confirmation. `resolvePending(memoryId,'apply'|'dismiss')` is the user's decision on a later change to a confirmed plan. `getProposal(id)` reads one proposal.
- Extraction never confirms anything; there is no action API in core. Call `validateForExecution` right before an adapter executes.

## Telemetry
`ingestText` and `query` results carry `telemetry: { task, mode, route:{id,model,cached,ms}, model, rawModelJson, validation:{ok,...}, rejected, modelAttempt? }`. `rawModelJson` is returned to the caller only (never stored in core state, so deletion cannot leak it); duplicate ingests have `rawModelJson:null, duplicate:true`; fallbacks have `mode:'fallback'`, `rawModelJson:null` and the failed model attempt under `modelAttempt`.

## Reused from the bridge (read-only source `E:\jarvis-aside-bridge\server.js`, sha256 1D0FB4BB..CFAA, 894 lines)
- L365-382 `digestBlock` prompt => `prompts.mjs` `EXTRACT_SYSTEM` / `DIGEST_SYSTEM` (adapted: item taxonomy, owner/missing/question, evidence, confidence); L391-404 item validation => `schema.mjs` `validateExtraction` / `validateDigest`; used by `core.summarizeWindow` (async, model-backed, read-only; `summarizeWindowDeterministic` is the sync simulated one).
- L408-421 `classifyIntent` prompt => `CLASSIFY_SYSTEM`, `schema.mjs` `validateClassify`, `core.classifyRequest(text) -> event|task|question`.
- Dropped on purpose: the "1~7 o'clock means PM" default (R05), the `ai` task owner, free-text evidence. Never read: `token.txt`, `devices.json`, `lifelog/`, `audit.log`, `models.json`.
