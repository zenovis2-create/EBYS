# English-first QA priority acceptance

sj-qa read and accepted `../../ENGLISH-FIRST-OWNER-UPDATE.md` on 2026-11-09 KST. English-native means the app's default language and complete user flow; it does not mean an Android platform rewrite. Korean remains optional. Ownership stays `qa/` only; product owners retain their files, fixes, source binding and confirmation gates. No shared-state reset, deleteAll, server restart, new audio recording, external messages or emergency calls.

Completion gate: save observed English-default and live-English evidence with explicit PASS/FAIL/BLOCKED/NOT RUN labels. At most two QA implementation passes; each checks syntax, unchanged expected facts, exact citations and measured API outcomes. A score alone does not establish complete app acceptance.

| English-first requirement | Independent acceptance / current evidence |
| --- | --- |
| Default English in fresh browser/storage, regardless of navigator locale | BLOCKED for actual browser: browser host unavailable; Chrome control rejected with `Computer Use was not approved to use Google Chrome`. Source baseline had `ui/index.html` lang=ko and `ui/i18n.js` initial lang=ko. Served assets are rechecked by the English runner, separately from browser evidence. No query-string English override counts as default proof. |
| Natural English input, navigation, status, errors and optional KO | Review every real UI screen in a fresh context. NOT RUN due browser access; English dictionaries alone are insufficient. |
| English voice with text alternative | Source maps English to en-US for TTS/ASR, checks availability, and labels capability. SOURCE ONLY: no voice/device execution or recording; unsupported voice must not be called operational. |
| New English conversation -> who/when/where and exact sources | Run `node qa/run-english-first.mjs`; new synthetic pottery/plant-swap scenario, serial live calls, raw responses and route/model/cache/ms saved. Only answers with verified utterance IDs/quotes/offsets pass. Model/fallback and missing model telemetry remain explicit. |
| English cancellation/supersession and unknown | Revised pottery date/place must supersede March 8/Amber Room; unstated kiln serial number stays unknown. No source means no invented fact. API recall is not memory-history or external cancellation proof. |
| Ambiguity -> English clarification -> explicit choice -> English confirm -> verified action or labelled preview | Runner checks unresolved eight AM/PM and clarification; exact time must remain null. UI choice/confirmation/action steps remain NOT RUN. English does not imply a US timezone: show Asia/Seoul explicitly unless changed through an explicit supported flow. |
| Cancel after proposal rejects stale confirmation | NOT RUN: later combined-flow QA must bind displayed fields, revision/digest and adapter mode, then cancel only its own synthetic proposal and prove stale confirm rejected. No real calendar action. |
| Errors/unknown, focus, enlarged text, large targets, reduced motion | API errors and unknown are recorded; actual focus/order, labels, overflow, contrast, targets and reduced-motion behavior remain NOT RUN without browser evidence. |
| Honest integration labels | Simulated/local calendar, OS notification capability, fallback and cached model output stay distinct. Never infer device/OS save from an API-only or preview result. |

Historical English held-out run `evidence/2026-11-09T02-13-06-266Z-170992/`: English participant passed via fallback, English AM/PM clarification passed via live cursor-cli/claude-sonnet-5-5-low (cached=false, 32637 model ms), unknown-speaker query was transport-blocked. This is partial historical evidence, not a fresh English-default browser or full English model-ingest pass. Full raw-model/validation evidence was missing.

Fresh evidence is written under `qa/evidence/english-first-<timestamp>-<pid>/report.json`, progressively after every request. Run `node qa/run-english-first.mjs --validate` first (offline fixture check); the runner never starts the lead server or invokes action/delete endpoints. If no server is reachable it records BLOCKED with zero HTTP requests. Product defects and remaining UI checks go to senior-planner/sj-ui/sj-memory/sj-actions for their own changes; QA does not patch product files.

## Fresh English run: 11:26 KST, 2026-11-09

Raw responses and scored checks: `evidence/english-first-2026-11-09T02-26-00-060Z-65628/report.json`.

- English questions: **3/3 PASS through the live model**; who/when/where, AM/PM clarification and unknown checks: **5/5 PASS**. Correct revised appointment: Celeste, March 10 2027 at 10:15 AM Asia/Seoul, Cedar Hall studio. Source quotes/IDs/offsets verified. No fallback answer credited as model output.
- Four uncached model calls (ingest + three queries) reported `cursor-cli / claude-sonnet-5-5-low`, cached=false. Model ms: **36146, 46021, 52593, 64220**; HTTP elapsed ms: **36173, 46034, 52611, 64229**. Each returned HTTP 200.
- English-default served-asset checks at **11:26:00 KST**: **0/2 PASS** (HTML lang=ko; initial module lang=ko). These are captured source failures, not a claim about later UI edits. Actual fresh-browser default remains BLOCKED. The run's overall FAIL reflects those served defaults, not the five passing recall checks.
- Complete raw-model/validation evidence: **BLOCKED**, both fields absent. Browser interaction, voice, English confirmation/action/cancellation, accessibility and device behavior remain unverified; this run does not certify English end-to-end release acceptance.
- Syntax/offline fixture validation passed (three questions, five slot checks, zero offline network calls); existing independent runner tests still **7/7 PASS**.
- **QA idle** was reported after process completion. No requests remain in flight; no server restart, delete/reset, action or confirm calls were made. Await lead restart-complete ping before another held-out run.

Independent lead-findings check: historical original runner hash was `1eca02ed4af4b3e047aab12a8665f4bc775d20f88af0660888e1b008a37c9b35`; current evaluator and saved rescore hash both `f4fcca03f6fd5c8e0fff682ec141f01ce9aff9cc7d8272c986cfc7353a2e9bee`. Both disputed answers PASS after the documented QA representation correction. The raw historical EN failures contain Cursor config-file rename EPERM. One delayed retry exists in current router source; loaded-runtime behavior has not yet been verified. The historical final transport failure is independently recorded; its attribution to the lead's restart is lead-reported, not independently observed.

## English-default recheck: 12:53 KST, 2026-11-09

Evidence: `evidence/english-default-recheck-2026-11-09T03-53-12-820Z-58352/report.json`. The two **HTTP/source** defaults that failed at 11:26 now both **PASS (2/2)**: served HTML lang=en, served i18n initial lang=en. Original 11:26 evidence remains unchanged; its FAIL no longer describes the served code at this recheck.

GET-only + pure served-module checks: **11/11 PASS**. Bare `/` returned 302 to `/?api=live` without a language override; root HTML/app.js/styles.css returned 200; empty/malformed/blocked synthetic storage kept English; explicitly selected/saved Korean stayed optional. Runtime version actions-0.1.0 and server/UI snapshots were stable before/after, serverCurrent=true; loaded server started at 12:51:40 KST.

The earlier 12:51:34 attempt had no HTTP responses and occurred before that observed server start. Its raw report is preserved under `english-default-recheck-2026-11-09T03-51-34-049Z-175992`; its initial generic FAIL labels are transport-unavailable observations, not evidence of Korean defaults. Collector now classifies transport unavailability BLOCKED and stops further HTTP attempts.

**Scope limit:** pure preference checks run served code in Node with synthetic storage. No new fresh browser profile/DOM mount/visual E2E or navigator-locale test was executed by sj-qa; parent Aside retains that ownership, and existing Chrome-control rejection was not bypassed. Lead's RESOLVED headless-browser report remains producer evidence. No model/action calls, server controls or storage resets were made. Receipt validator now accepts both canonical root-live and explicit ui-live entries; its offline regression tests are **18/18 PASS**.
