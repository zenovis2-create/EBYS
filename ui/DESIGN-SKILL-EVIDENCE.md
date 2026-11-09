# EBYS UI redesign: design-skill evidence

Owner: sj-ui (Cursor Opus 5.5, the only UI writer). Scope: `senior-jarvis/ui/` only. First working redesign: 2026-11-09 12:48 KST.

## 0. CURRENT direction: blue mascot-first home (`PRIMARY-HOME-USER-UPDATE.md`, accepted 13:33 KST)

This section supersedes the navy/ivory "person + arc" brand described further down; those SVG files were deleted.

Images actually viewed (Read tool, 13:33 KST):
- Exact primary icon: `C:/Users/User/.aside/u/1/sessions/2026-11-07_g2cUyYVbjCJYZr1M/attachments/image-ac07c405-7b83-435b-9585-d5bca5424380.png` (1254×1254 PNG, 2,033,342 B, SHA-256 `F8C2776843CACF50B05EC63A9FE2B7EA4D381CB5BE73F8ACBED948BA861AE44B`).
- Chosen home: `.../attachments/image-eb4e7d7f-9dd0-42dd-adea-bf2c5b56704b.png` (941×1672). The forest-green alternative `image-690685bf…` was not used.

Skills re-read (Read tool, 13:28:31 KST): `C:/Users/User/.agents/skills/frontend-design/SKILL.md` + `LICENSE.txt`, `.cursor/skills/ebys-mobile-design/SKILL.md` + `references/selected-guidance.md`, `.cursor/skills/impeccable-ebys-reference/SKILL.md`. These are prose only: no installer, engine, hooks or global config.

| Chosen-home element | Implementation | File / selector | Proof |
|---|---|---|---|
| Exact icon, bytes preserved | Copied byte for byte; square resizes 32/96/180/192/512 (HighQualityBicubic, no crop or stretch) | `assets/ebys-icon-original.png`, `assets/ebys-icon-{32,96,180,192,512}.png` | Unit test checks the SHA-256 and the PNG IHDR sizes; `tools/http-assets.mjs` on the live server returned 200 `image/png` at the right size for every file and the same hash |
| Favicon, apple-touch, manifest | `<link rel=icon>` 32/192, `apple-touch-icon` 180, `manifest.json` (`display: "browser"`, so no installed-app claim) | `index.html`, `manifest.json` | Live server serves `manifest.json` as `application/json` |
| Visible brand | Icon + "EBYS" wordmark in the app bar (tapping it goes Home); the mascot is the 512px icon | `app.js` `AppBar` `.brand-icon` `.wordmark`; `screens/home.js` `img.mascot` | Smoke: decoded `naturalWidth` 512 / 96 |
| Soft sky + teal + cream + golden arc | Tokens: `--bg #e3f3fc` (sky), `--navy #0b4f55` (deep-teal ink), `--ivory #fff8e8` (cream), `--gold #f5a524` (decorative arc), `--gold-on-navy #ffe0a3` | `styles.css :root` | AAA contrast unit test over all text pairs (≥ 7:1) |
| Large time-aware greeting + help line | "Good morning! / Good afternoon! / Good evening!" from the device hour + "What can I help you with?" | `screens/home.js` `greetingKey`, `.greeting`, `.help` | Unit test (hour boundaries) + smoke |
| Prominent "Talk to EBYS" | Full-width teal pill, 4.2rem tall, opens Chat (typed question). The mic icon shows only when the browser exposes speech recognition; the note says "Voice works only where this browser supports it." | `.btn-talk`, `.talk-note` | Smoke: ≥ 64px and ≥ 330px wide; opens Chat with `#q` |
| Three cream actions | **My plans** (Plans screen), **Add a memory** (consent + text/sample ingest), **Find a memory** (Memories). The mockup's "Call my family" and "Set a reminder" are **not** shown: calling is unsupported and reminders only come from a confirmed plan | `screens/home.js` `ACTIONS`, `.actions` `.action` `.action-icon` | Unit + smoke: labels exactly these three, no call/taxi/119/reminder wording |
| Bottom Home / Chat / Memory / Settings | Plans/Add/Proposal live under Home; Settings = the existing privacy and settings screen | `app.js` `NAV`; `.bottomnav` `.nav-on` | Smoke: labels exact and unclipped at 100%, 150% and in Korean |
| Honest sample vs live | Pill "Sample · not real AI" vs "Live AI"; the sample loader's progress now says "Loading sample data (not real AI)"; live wait copy says "up to a minute or two" | `progress.js` `MODEL_STEPS`, `i18n.js` `prog.sample`, `prog.calm` | Unit test on the copy |

Preserved: consent, source quotes, ambiguity and explicit AM/PM (GAP3), confirm/cancel truth, simulated vs real-local-calendar labels ("where saved" line on a verified save), English default, optional Korean (`:lang(ko) { word-break: keep-all }`), 22px body, ≥ 56px targets (64 primary), focus, zoom and reduced motion.

Validation (14:06 KST, offline first, no concurrent model calls):

```
node --test ui/test/ui.test.mjs                                        tests 30, pass 30, fail 0
node ui/tools/smoke.browser.mjs                                        93/93 checks passed (sample mode)
node ui/tools/http-assets.mjs http://127.0.0.1:8787                    all asset checks passed (GET only)
node ui/tools/smoke.browser.mjs --live=http://127.0.0.1:8787 --live-home   3/3 (live home; nothing ingested or asked)
```

Fresh 390×844 screenshots (viewport only, not stitched): `ui/tools/screens/01-home-en-390x844.png` (sample), `19-live-home-en-390x844.png` (live server), `13-home-ko-390x844.png` (Korean option). Full-page captures of every flow are `01`–`17` in the same folder.
The last full live model run (ingest → answer → clarify → confirm → verified local save) was at 13:24 KST (16/16) before this reskin. No model call was made after the reskin so QA's capture would not be disturbed. This pass changed styling, the new Home hub, the nav/routes, the Add-screen header and the progress copy. The ingest/ask/propose/confirm logic and API calls were not changed. The sample-mode run (93/93) walks the same flow through the new Home → Add / Chat path, but a live model run after the reskin is **still owed** and is listed as a risk.

### 0a. Primary icon confirmation and internal icon style (`PRIMARY-ICON-OWNER-UPDATE.md`, read 14:21 KST)

- The user's attachment `C:/Users/User/.aside/u/1/sessions/2026-11-07_g2cUyYVbjCJYZr1M/attachments/image-ac07c405-7b83-435b-9585-d5bca5424380.png` (2,033,342 B, PNG) has SHA-256 `F8C2776843CACF50B05EC63A9FE2B7EA4D381CB5BE73F8ACBED948BA861AE44B`, identical to `ui/assets/ebys-icon-original.png`. It is the visible app-bar brand (96), the Home mascot (512), favicon (32/192), apple-touch (180) and manifest icons (192/512/original). The manifest is web metadata only, not proof of a native install. No person/arc SVG is used anywhere in the UI.
- Internal icons (`ui/lib/icons.js`) now follow the mascot's vocabulary: rounded corners on every box shape (`rect rx`), round caps and joins, and a soft tint of the stroke colour inside the main shape (`.icon .tint`, 16% opacity). Inside the cream Home action tiles and the active nav tab, the tint is gold (`--gold` at 45%) under the teal stroke. Under `forced-colors` the tint is removed.
- Home actions now have distinct icons: My plans = calendar, Add a memory = rounded plus, Find a memory = magnifier (`screens/home.js` `ACTIONS`). Chat uses a rounded speech bubble with three dots.
- Icons stay decorative (`aria-hidden`); every meaning is in the visible word next to it. Copy, keys, selectors, sizes and contrast tokens did not change.
- Validation at 14:27 KST: unit 30/30, sample smoke 93/93 (includes no horizontal overflow, controls ≥ 56px, primary ≥ 64px, nav labels unclipped), `http-assets` all pass (200, `image/png`, exact dimensions, original hash). Screenshot: `ui/tools/screens/01-home-en-390x844.png`.

## 1. Sources actually read (2026-11-09, 12:05 KST)

| Source | Path | License / status |
|---|---|---|
| Owner brief | `C:/Users/User/.aside/u/1/research/senior-jarvis-hackathon/OPUS-UI-REDESIGN-OWNER.md` | project doc |
| Global frontend-design skill | `C:/Users/User/.agents/skills/frontend-design/SKILL.md` (+ `LICENSE.txt`) | Apache-2.0, read offline |
| Project mobile skill | `.cursor/skills/ebys-mobile-design/SKILL.md` | project |
| Selected prose | `.cursor/skills/ebys-mobile-design/references/selected-guidance.md` | MIT excerpts (Vercel guidelines, UI UX Pro Max, Emil Kowalski, Hallmark), attributions kept there |
| Impeccable reference | `.cursor/skills/impeccable-ebys-reference/SKILL.md` (+ `NOTICE.md`) | Text read at 12:05 under the 12:04 owner instruction. Per the lead's 13:04 order, Impeccable and Stageshow are **not approved for use**: no tool, engine, command or code from them is in `ui/`, and none of the 13:05 polish relies on them |
| Before screenshots | `C:/Users/User/.aside/u/1/sessions/2026-11-08_5GCW81A8SLVUvJ7x/tmp/ebys-current-ui-english.png`, `.../ebys-ui-before-english-polish.png` | |
| Storyboard (inspiration only) | `C:/Users/User/.aside/u/1/sessions/2026-11-07_g2cUyYVbjCJYZr1M/artifacts/EBYS-storyboard.png` | Not copied. Its raster screens, AI-invented weekday/dates and medical/reminder claims are not product evidence. |

Nothing was installed, no hooks or global config were changed, no paid image API was used, and no web fonts are loaded (system font stacks only).

## 2. Principles and where they live

| Principle (source) | Implementation |
|---|---|
| Bold, intentional aesthetic; avoid generic AI look (frontend-design) | Warm navy `#13284a` / ivory `#fbf6ec` / sand, a gold companion accent used only decoratively; serif display (Iowan/Palatino/Georgia) over humanist body (Seravek/Segoe UI). `styles.css` `:root` tokens |
| Brand lives in details (impeccable) | Original mark: a person with a gold arc "at their side" (Ever By Your Side). `assets/ebys-mark.svg`, `lib/icons.js` `BrandMark` |
| Operate mode: one primary action per screen (ebys-mobile-design) | Home: "Read this conversation" in `.actionzone`; Ask: "Ask" then "Make it a plan?"; Confirm: "Yes, confirm" directly under the readback, with Cancel separated below the notes |
| Progressive complexity | Home three-step path (`.hero .path`); title/provenance in `details.more`; mic (unverified) moved below the answer; settings behind the gear `.iconbtn` |
| Large type and targets (senior a11y) | 22px base × scale, `--tap` 57px, `--tap-primary` 65px, nav labels fixed 17px; tested in `ui.test.mjs` "CSS 22/56/64" |
| 7:1 contrast | AAA contrast test over all text tokens (`ui.test.mjs`) |
| Visible `:focus-visible` (Vercel) | 4px `#c2410c` outline + paper halo |
| Never disable zoom (Vercel) | viewport has no `maximum-scale`/`user-scalable`; test asserts it |
| Respect reduced motion (Emil / Vercel) | `@media (prefers-reduced-motion: reduce)` block; press feedback is 120ms ease-out only |
| No hover-only interactions | all actions are buttons with visible labels |
| Labels on icon buttons | gear `aria-label="Settings and privacy"`; icons are `aria-hidden` |
| Focus the first error | consent error focuses `#consent` (smoke-checked) |
| Errors say the next step | `errc.*` copy, `ErrorBox` prefers server `userHint` |
| `text-wrap: balance` for headings | h1–h3 |
| Honest state (contracts) | `displayState()` mirror; only `completed_external` may say saved; simulated cards are striped; mode pill "Sample · not real AI" vs "Live AI" |

## 3. Brand assets (SUPERSEDED at 13:33: the SVG mark/logo below were deleted; see section 0)

- `ui/assets/ebys-mark.svg` (64×64 symbol, also the favicon via `<link rel="icon" type="image/svg+xml">` and apple-touch-icon)
- `ui/assets/ebys-logo.svg` (300×72 mark + EBYS wordmark + "EVER BY YOUR SIDE")
- In-app: `BrandMark()` in `ui/lib/icons.js` (same geometry, built with `createElementNS`, no innerHTML)

## 4. Files changed in this redesign

New: `assets/ebys-mark.svg`, `assets/ebys-logo.svg`, `lib/icons.js`, `lib/prefs.js`, `lib/preview.js`, `DESIGN-SKILL-EVIDENCE.md`.
Rewritten: `index.html`, `app.js` (app bar, mode pill, gear, 4-tab nav), `styles.css`, `screens/input.js` (Home), `samples.js`, `services/fixtureApi.js` (now uses core shapes), `test/ui.test.mjs`, `tools/smoke.browser.mjs`.
Edited: `i18n.js` (English-first copy, new keys), `components.js` (object slots, timezone note, error codes), `screens/proposal.js` (GAP3 + confirm hierarchy), `screens/ask.js` (caveats, clarification options, `memoryId` plan), `screens/memories.js`, `screens/privacy.js` (Settings card), `lib/speech.js` (bug fix: `new g().SpeechSynthesisUtterance` threw, so read-aloud never spoke).

## 5. Recovered work: the cancelled `proposal.js` edits and GAP3

- `whenSeed()` and `candidateOptions()` accept core object candidates `{date,time,startIso,labelEn,labelKo}` and legacy strings, with partial nulls handled and duplicates removed.
- Chip labels state AM/PM explicitly; AM/PM is never preselected.
- Nested preview is normalized by `lib/preview.js`; server `modeLabel`, warnings, notifications and `readbackText` are shown; `needs_clarification` shows the server prompt.
- A cancelled proposal cannot be confirmed (`proposal_closed`); a superseded memory cannot be proposed (`memory_not_active`).

## 6. Validation (latest 13:05 KST)

```
node --test ui/test/ui.test.mjs
  tests 28, pass 28, fail 0

node ui/tools/smoke.browser.mjs --live=http://127.0.0.1:8787
  92/92 checks passed (57 sample-mode + 9 live + 26 "no untagged Korean on English screens")
```

The smoke test runs headless Chrome at 390px with `--lang=ko-KR` and a fresh profile, so it proves English is the default without relying on the browser locale. Checks include: no x-overflow, nav fits, primary button height ≥ 64, brand mark and favicon, consent focus, GAP3 chips, AM/PM refusal, timezone readback, simulated result, cancel truth, Korean toggle that persists then switches back, 150% scale, every fault state, and no console errors.

Live (real backend, `cursor-cli · claude-sonnet-5-5-low`): a new English synthetic conversation took 95 s to ingest and the answer took 138 s. The answer had who/when/where/what slots linked to sources. The clarification offered 4 object candidates labelled with AM/PM, and AM/PM was not preselected. The readback was in English with Seoul time, and the result read "Simulated · not really saved". Only that session was deleted afterwards (per-session delete).

## 6b. English-first evidence (`ENGLISH-FIRST-OWNER-UPDATE.md`, read and accepted 2026-11-09 12:59 KST)

| Requirement | Status | Proof |
|---|---|---|
| Fresh storage defaults to English, not the browser locale | Done | `lib/prefs.js` never reads `navigator.language`; unit test "English default"; smoke runs Chrome with `--lang=ko-KR` and a fresh profile and gets `<html lang="en">` |
| Korean optional, not removed | Done | Settings → Language → 한국어; persists under `ebys.prefs`; smoke switches to Korean and back |
| Natural English copy end to end | Done | Rewritten EN strings (home, recall, source, clarify, confirm, errors, settings). Smoke checks that **every English screenshot (26 screens incl. 7 live) has no Korean text** unless the element is tagged `lang="ko"` (for example the Korean sample or the 한국어 button) |
| en-US voice / speech input only where supported, honest labels | Done | `lib/speech.js` sets `u.lang` / `rec.lang` = `en-US` in English; controls are hidden when the API is absent; labelled "(unverified)"; text is always shown. Unit tests cover the TTS and ASR language. Not verified on real devices |
| Time zone explicit, English ≠ US time zone | Done | "Seoul time (Asia/Seoul, UTC+9)" on the form, readback and settings, plus the device zone and a mismatch note; no silent conversion |
| Ambiguous AM/PM and dates clarified, never defaulted | Done | GAP3 tests incl. the real `core/time.mjs` output; live clarify card showed 4 AM/PM-labelled chips, none preselected |
| Cancel after proposal blocks a stale confirm | Done in sample mode | Smoke "cancel says nothing was sent; no confirm button remains"; fixture returns `proposal_closed`. Not exercised against the live server in this run |
| Errors, focus, large targets, reduced motion | Done | `errc.*` English copy + server `userHint`; consent error focus; 56/64px targets; reduced-motion block; all tested |

Live English run (13:05 KST, `cursor-cli · claude-sonnet-5-5-low`, new synthetic text with "next Wednesday at 4"): ingest 46 s, answer 62 s, 9/9 live checks pass. Only that session was deleted afterwards.
Known accuracy issue (core/model, not UI): the live answer's "Who" was "Alex" (Inferred), but Alex is the son driving; the appointment is Tom's.
Known cosmetic issue: the native `<input type="date">` placeholder follows the browser locale (Korean in the test browser), not the page language.

## 6c. Senior-mobile polish pass (lead order 13:04, `DESIGN-SKILL-APPLICATION.md`)

Skill re-read with the native Read tool: `C:/Users/User/.agents/skills/frontend-design/SKILL.md` at **2026-11-09 13:04:57 KST** (Apache-2.0, text only; no install, npx, hooks or global change). Also read `DESIGN-SKILL-APPLICATION.md` (repo root).

Principles chosen, and the ones deliberately skipped:

| frontend-design principle | Applied as | File / selector |
|---|---|---|
| "Commit to a cohesive aesthetic… dominant colours with sharp accents" | The gold rule (the brand's companion arc) now means "this is tied to a source or a question" in one place each: source quotes and the clarify card | `styles.css` `.ev-quote` (border-left gold), `.clarify` (border-left gold) |
| "Refined designs need restraint, precision, careful spacing and typography" | Confirm readback stacks label over value; values in the serif display face at 1.2rem; separators between rows, none after the last | `styles.css` `.rb-row`, `.rb-row dt`, `.rb-row dd`, `.rb-row:last-child` |
| "Backgrounds and visual details… decorative borders, depth" | Each source becomes its own slip: ivory card, speaker line with a person icon, large serif opening quote mark, and a check icon on the verified line | `components.js` `openEvidence()`; `styles.css` `.ev-item`, `.ev-quote::before`, `.ev-speaker`, `.ev-ok` |
| "Distinctive, context-specific components, not cookie-cutter" | Candidate times are full-width choice cards (clock icon, check icon and navy fill when chosen, `aria-pressed`) instead of generic pills | `screens/proposal.js` `FormStep` `.choice-list`; `styles.css` `.chip.choice`, `.choice-on` |
| "One well-orchestrated page load with staggered reveals beats scattered micro-interactions" | One 240ms rise with 40ms steps, played **only when the proposal step changes** (not on every tap, because each tap re-renders); a 120ms press on choice cards | `screens/proposal.js` `renderProposal` (`step-enter`, `lastStepKey`); `styles.css` `@keyframes rise`, `.step-enter > *`, `.chip.choice:active` |
| (EBYS constraint) reduced motion | Both the entrance and the press are switched off | `styles.css` `@media (prefers-reduced-motion: reduce)` |
| Typography: "avoid system fonts, use distinctive web fonts" | **Not followed**: web-font downloads are forbidden. We keep the local serif display stack (Iowan / Palatino / Georgia) over a humanist body stack | `styles.css` `--font-display`, `--font-body` |
| Spatial composition: "asymmetry, overlap, diagonal flow, grid-breaking" | **Skipped on purpose**: it hurts older-adult readability. Single column, predictable order | — |
| "Scroll-triggering and hover states that surprise" | **Skipped**: no hover-only or scroll-triggered behaviour | — |

Size floor fixes found during this pass (`design-ui.md` line 55: body 22px, badges ≥ 18px):
- Some text was below the floor before this pass. It is now fixed: the time-zone note 0.85rem → 1rem, helper text `.small` 0.82rem → 1rem, the honesty footer 0.8rem → 1rem, and badges/pills/nav/steps 15–17.6px → 18px.
- The stepper now shows numbers with only the current step's label written out, so the labels don't break mid-word at 18px; the other labels stay available to screen readers.
- The time-zone emoji 🕒 is replaced by the clock icon from the shared icon set, and the duplicate ✔ in "Matches the original text" is removed now that an icon shows it.

Tests after the polish:

```
node --test ui/test/ui.test.mjs           tests 29, pass 29, fail 0
node ui/tools/smoke.browser.mjs           80/80 checks passed (fixture mode)
```

New tests:
- Unit test "source/clarify/confirm cards keep text >= 22px…": every CSS `font-size` is ≥ 18px; `.small`, `.tznote` and `.honesty` are 1rem; the reduced-motion block turns off `.step-enter` and the choice press.
- Smoke checks:
  - the tapped time choice shows a pressed state;
  - choosing a time does not replay the entrance;
  - a new step plays the `rise` entrance;
  - under the emulated `prefers-reduced-motion: reduce` it is `none`.
- The PM-chip smoke check is now stricter: it reads the AM/PM toggle itself, not just any pressed button ending in "PM".

Before / after (390px):
- Before: `ui/tools/screens/before-polish/03-source-en.png`, `05-proposal-en.png`, `06-clarify-refused-en.png`, `07-confirm-en.png`
- After: `ui/tools/screens/03-source-en.png`, `05-proposal-en.png`, `06-clarify-refused-en.png`, `07-confirm-en.png`

Fixture vs live: the 80 checks and the screenshots above are **fixture (sample) mode**. A separate live run (`--only-live`) exercises the same Clarify/Confirm components against the real backend; its result is recorded in the lead report. The fixture follows the core shapes but does not prove model accuracy.

## 7. Before / after

- Before: the two PNGs in section 1. The app was Korean by default, had a debug-style mode label and no brand mark, and its nav and actions competed for attention.
- After (390px, `ui/tools/screens/`): `01-home-en.png`, `02-memories-en.png`, `03-source-en.png`, `04-answer-en.png`, `05-proposal-en.png`, `06-clarify-refused-en.png`, `07-confirm-en.png`, `08-result-simulated-en.png`, `11-cancelled-en.png`, `12-settings-en.png`, `13-home-ko.png`, `14-home-en-150.png`, `15-settings-en-150.png`, `16-fault-*-en.png`, `20`–`26-live-*-en.png`.
- Note: these are full-page CDP captures, so the fixed bottom nav appears partway down the image. On a real viewport it sits at the bottom.

## 8. Remaining risks

- Tested only in desktop Chrome mobile emulation, not on real phone hardware, a real screen reader or iOS Safari.
- Live latency is 95–140 s per model call; the progress UI covers it, but it is slow for a demo.
- Speech output and input depend on the browser and are labelled "unverified"; the text is always shown.
- The fixture is a stand-in that follows core shapes. Anything only the live server returns (new warning codes) falls back to generic copy.
