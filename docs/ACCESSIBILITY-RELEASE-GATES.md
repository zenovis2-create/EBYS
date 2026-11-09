# ACCESSIBILITY-RELEASE-GATES.md — Senior Jarvis (EBYS) Accessibility & Platform Release Gates

**Owner:** `sj-ux` (Antigravity native, Gemini 3.8 Flash High)  
**Lead / QA Runner:** `senior-planner` (Cursor lead / Parent browser QA)  
**Status:** Canonical Release Gates for Senior Accessibility & Platform Integrity  
**Applicability:** Mobile-First Web Application (390px baseline, Chrome/Android WebView/Desktop)

---

## 1. Overview & Verification Philosophy

This document defines the strict, non-negotiable **Release Gates** for the Senior Jarvis (EBYS) user interface and conversational experience. 

In adherence to `PRODUCT-ACCEPTANCE.md`, `CONTRACTS.md`, and hackathon truthfulness rules:
- **No False Platform Claims:** Standard browser Web Speech API does not support programmatic silence threshold overrides (there is no `pauseThreshold` API). Browser speech recognition timing is controlled internally by the browser engine and must be treated as `runtime unverified`.
- **No Medical Guarantees:** Voice playback adjustments (0.85x speed) are ergonomic accommodations, not medical acoustic treatments or hearing-loss compensations.
- **Calendar & Reality Truthfulness:** Calendar dates and days of the week must match the real 2026 calendar (e.g., November 13, 2026 is Friday; November 14, 2026 is Saturday). The system must never fabricate personal routines (such as "lunch routines") not stated by the user.
- **English-Native First:** English is the default UI and conversational language; Korean remains an optional toggle.

---

## 2. Senior UX Release Gates Checklist

The following 7 gates must pass before final demo and release sign-off.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              SENIOR UX RELEASE GATES                                   │
├───────────────┬─────────────────────────────────────────────────────────┬──────────────┤
│ Gate          │ Requirement Specification                               │ Target State │
├───────────────┼─────────────────────────────────────────────────────────┼──────────────┤
│ Gate 1: View  │ 390px width viewport, 0 horizontal scroll, 4 tabs fit    │ PASS / FAIL  │
│ Gate 2: Touch │ 56px min target, 64px primary action & nav items        │ PASS / FAIL  │
│ Gate 3: Type  │ 22px base body, clean reflow at 125% and 150% zoom      │ PASS / FAIL  │
│ Gate 4: A11y  │ WCAG AAA (7:1) contrast, 4px visible focus, no anim loop │ PASS / FAIL  │
│ Gate 5: Time  │ Explicit AM/PM, spelled-out dates, visible timezone     │ PASS / FAIL  │
│ Gate 6: Voice │ Rate 0.85x, manual stop fallback, zero invented ASR API │ PASS / FAIL  │
│ Gate 7: Truth │ Correct unverified labels; no fake call tap/119         │ PASS / FAIL  │
└───────────────┴─────────────────────────────────────────────────────────┴──────────────┘
```

---

### Gate 1: Viewport Geometry & Mobile Bounds (390px Baseline)
*   **Target Width:** Standard compact smartphone viewport width (**390px** / iPhone 12–14 / Galaxy S-series baseline).
*   **Horizontal Integrity:** `document.documentElement.scrollWidth <= window.innerWidth`. Zero horizontal scrollbars under all states.
*   **Bottom Navigation Bar:**
    *   All 4 primary navigation items (`Input`, `Memory`, `Ask`, `Plans`, plus `Privacy`) must fit side-by-side on a 390px screen without label truncation, text wrapping, or overlapping.
    *   Navigation item labels must remain visible and legible at all scale levels.
*   **Safe Areas:** Respect `env(safe-area-inset-top)` and `env(safe-area-inset-bottom)`.

---

### Gate 2: Touch Target Geometry & Spacing
*   **Secondary Controls:** Minimum **56×56 px** hit area (`--tap: 2.6rem` at 22px base = 57.2px).
*   **Primary Action Buttons:** Minimum **64 px** height, full width or dominant flex (`--tap-primary: 2.95rem` at 22px base = 64.9px).
    *   Examples: "Yes, add to schedule", "Speak", "Confirm".
*   **Bottom Navigation Items:** Minimum **64 px** height per tab touch zone.
*   **Defensive Spacing:**
    *   Minimum **12–16 px** physical gap between non-destructive and destructive actions.
    *   "Cancel" or "Delete" must never share a border with "Confirm".

---

### Gate 3: Typography, Sizing & Dynamic Reflow
*   **Base Body Size:** Minimum **22 px** at 100% scale (`html { font-size: calc(22px * var(--scale)); }`).
*   **Absolute Minimum Font Size:** No functional text, label, or badge may render below **16 px**.
*   **Scale Toggles:** Must support `1.0x (100%)`, `1.25x (125%)`, and `1.5x (150%)` text scaling.
*   **Reflow Guarantee:** At 150% scale, containers must expand vertically. No text clipping, no ellipsis (`text-overflow: ellipsis`) on crucial conversational data (names, dates, times, source quotes).

---

### Gate 4: Contrast, Color Independence & Motion
*   **Contrast Ratio:**
    *   Body text on background: **≥ 7.0:1 (WCAG AAA)**.
    *   Brand Navy (`#13284a`) on Ivory (`#fbf6ec`) = 12.8:1 (Passes AAA).
    *   Body Text (`#1a1f2b`) on Paper (`#fffdf8`) = 14.1:1 (Passes AAA).
    *   Large headings: **≥ 4.5:1 (WCAG AA/AAA)**.
*   **Triple-Coding for State (Color Independence):**
    *   Colour must never be the only indicator of system state.
    *   Every card, chip, or banner must combine:
        1.  Distinct high-contrast color.
        2.  A recognizable icon (e.g., `🔴`, `⏸`, `✓`, `!`).
        3.  Plain-text English state label (e.g., `LISTENING`, `PAUSED`, `VERIFIED`).
        4.  Distinct border styling (solid, dashed, dotted, or double).
*   **Focus Visibility:**
    *   Every interactive element must present a high-contrast focus ring: 4px solid outline with 3px offset (`:focus-visible { outline: 4px solid var(--focus); outline-offset: 3px; }`).
*   **Reduced Motion (`prefers-reduced-motion: reduce`):**
    *   Continuous animations (e.g., spinning loaders) must freeze to a static state.
    *   Transitions (`transform`, `opacity`) must resolve instantly (0ms).

---

### Gate 5: Date, Weekday, Timezone & AM/PM Precision
*   **Calendar Realism:**
    *   All sample scenarios and date calculations must conform to the real calendar:
        *   **Friday is November 13, 2026.**
        *   **Saturday is November 14, 2026.**
        *   **Sunday is November 15, 2026.**
    *   Never display mismatched dates and weekdays (e.g., do not output "Friday, November 14, 2026").
*   **Spelled-Out Months (Anti-Ambiguity):**
    *   Never output ambiguous numerical date strings (`11/12/2026`).
    *   Always output spelled-out format: `"Friday, November 13, 2026"` or `"Saturday, November 14, 2026"`.
*   **Explicit AM/PM Clarification:**
    *   Bare hours (e.g., "Doctor at 9") must trigger an explicit clarification dialogue:
        *   `"Did you mean 9:00 in the morning or 9:00 at night?"`
    *   Never guess AM or PM silently.
*   **Timezone Transparency:**
    *   All appointment readbacks must display the active timezone abbreviation:
        *   Example: `"Friday, November 13, 2026 at 2:00 PM KST"`.
*   **No Fabricated Personal Routines:**
    *   Do not invent arbitrary user routines (e.g., do not state "1 hour after lunch" unless the user explicitly stated "after lunch" in the conversation transcript).

---

### Gate 6: Voice Interaction Truthfulness & Fallbacks
*   **Web Speech API Constraints (No Invented APIs):**
    *   The Web Speech API does **not** provide an exposed silence timeout property. Silence cutoff is governed by the host browser's speech recognition service.
    *   The application must provide **explicit Push-to-Talk controls**:
        1.  `Start Listening` button.
        2.  `Stop Listening` manual button.
        3.  Text input fallback field available on the same screen.
*   **TTS Rate Adjustment (Ergonomic, Not Medical):**
    *   `SpeechSynthesisUtterance.rate` set to `0.85` for comfortable, measured pacing.
    *   Do not claim proprietary or clinical acoustic frequency boosts in the presentation or documentation.
*   **Missing Voice Fallback:**
    *   If no English voice (`en-US`) is available in the browser, render a clear in-line message: `"Voice read-aloud is not available on this device. Please read the text on screen."`

---

### Gate 7: Honest Provenance & Runtime State Labelling
*   **Provenance Taxonomy:**
    *   `SYNTHETIC DATA · DEMO`: Applied to all sample conversations, transcripts, and pre-loaded scenarios.
    *   `CONSENTED DATA`: Applied only if a live user explicitly provides consent.
    *   `SIMULATED PREVIEW`: Applied to notification previews and external calendar handoff screens.
    *   `ROADMAP`: Applied to 24h continuous audio capture, live call stream interception, Wear OS BLE hardware sync, and emergency 911/119 calling.
*   **No Fake Success on Failure:**
    *   If an action fails or permissions are denied, the UI must show an error state with plain English explanation and retry button. Never show a false green "Saved" badge.

---

## 3. Critical Verification Checklist for Parent QA Runner

Before demo recording or submission packaging, the parent test runner must verify:

1. [ ] **390px Test:** App loads at 390px viewport width without horizontal scroll (`scrollWidth === innerWidth`).
2. [ ] **Tab Fit Test:** All 4 bottom navigation tabs fit horizontally at 100%, 125%, and 150% zoom levels.
3. [ ] **Touch Target Test:** Primary action buttons measure ≥ 64px high; secondary buttons measure ≥ 56px high.
4. [ ] **Contrast Test:** Text color contrast passes WCAG AAA (≥ 7.0:1) on primary body text pairs.
5. [ ] **Calendar Test:** Date fixtures cite correct 2026 weekdays (Friday Nov 13, Saturday Nov 14).
6. [ ] **AM/PM Ambiguity Test:** Bare "at 9" input triggers AM/PM clarification dialogue.
7. [ ] **Timezone Tag Test:** Proposal cards display explicit timezone (e.g., `KST`).
8. [ ] **Focus Ring Test:** Keyboard tab navigation renders visible 4px outline with high contrast offset.
9. [ ] **Reduced Motion Test:** Enabling `prefers-reduced-motion` halts spinner animation.
10. [ ] **Voice Truthfulness Test:** No fabricated speech API properties; push-to-talk buttons and text fallbacks function cleanly.

---

*Authored by `sj-ux`. Canonical release gates document ready for team validation.*
