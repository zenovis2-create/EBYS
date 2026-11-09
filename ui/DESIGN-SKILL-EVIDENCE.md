# EBYS UI redesign: design-skill evidence

Owner: sj-ui (Cursor Opus 5.5, the only UI writer). Scope: `senior-jarvis/ui/` only. First working redesign: 2026-11-09 12:48 KST.

## 1. Sources actually read (2026-11-09, 12:05 KST)

| Source | Path | License / status |
|---|---|---|
| Owner brief | `C:/Users/User/.aside/u/1/research/senior-jarvis-hackathon/OPUS-UI-REDESIGN-OWNER.md` | project doc |
| Global frontend-design skill | `C:/Users/User/.agents/skills/frontend-design/SKILL.md` (+ `LICENSE.txt`) | Apache-2.0, read offline |
| Project mobile skill | `.cursor/skills/ebys-mobile-design/SKILL.md` | project |
| Selected prose | `.cursor/skills/ebys-mobile-design/references/selected-guidance.md` | MIT excerpts (Vercel guidelines, UI UX Pro Max, Emil Kowalski, Hallmark), attributions kept there |
| Impeccable reference | `.cursor/skills/impeccable-ebys-reference/SKILL.md` (+ `NOTICE.md`) | reference only, no engine/hook installed |
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

## 3. Brand assets

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

## 6. Validation (12:47 KST)

```
node --test ui/test/ui.test.mjs
  tests 27, pass 27, fail 0

node ui/tools/smoke.browser.mjs --live=http://127.0.0.1:8787
  66/66 checks passed (57 sample-mode + 9 live)
```

The smoke test runs headless Chrome at 390px with `--lang=ko-KR` and a fresh profile, so it proves English is the default without relying on the browser locale. Checks include: no x-overflow, nav fits, primary button height ≥ 64, brand mark and favicon, consent focus, GAP3 chips, AM/PM refusal, timezone readback, simulated result, cancel truth, Korean toggle that persists then switches back, 150% scale, every fault state, and no console errors.

Live (real backend, `cursor-cli · claude-sonnet-5-5-low`): a new English synthetic conversation took 95 s to ingest and the answer took 138 s. The answer had who/when/where/what slots linked to sources. The clarification offered 4 object candidates labelled with AM/PM, and AM/PM was not preselected. The readback was in English with Seoul time, and the result read "Simulated · not really saved". Only that session was deleted afterwards (per-session delete).

## 7. Before / after

- Before: the two PNGs in section 1. The app was Korean by default, had a debug-style mode label and no brand mark, and its nav and actions competed for attention.
- After (390px, `ui/tools/screens/`): `01-home-en.png`, `02-memories-en.png`, `03-source-en.png`, `04-answer-en.png`, `05-proposal-en.png`, `06-clarify-refused-en.png`, `07-confirm-en.png`, `08-result-simulated-en.png`, `11-cancelled-en.png`, `12-settings-en.png`, `13-home-ko.png`, `14-home-en-150.png`, `15-settings-en-150.png`, `16-fault-*-en.png`, `20`–`26-live-*-en.png`.
- Note: these are full-page CDP captures, so the fixed bottom nav appears partway down the image. On a real viewport it sits at the bottom.

## 8. Remaining risks

- Tested only in desktop Chrome mobile emulation, not on real phone hardware, a real screen reader or iOS Safari.
- Live latency is 95–140 s per model call; the progress UI covers it, but it is slow for a demo.
- Speech output and input depend on the browser and are labelled "unverified"; the text is always shown.
- The fixture is a stand-in that follows core shapes. Anything only the live server returns (new warning codes) falls back to generic copy.
