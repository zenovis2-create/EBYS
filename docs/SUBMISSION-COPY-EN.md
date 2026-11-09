# EBYS submission copy (English draft)

**DRAFT.** Not submitted. The event form has not arrived. Do not publish or push from this file. This is not the Mac narration or the final description.

## One line

EBYS is a phone-first assistant that keeps who, when, and what from a conversation, shows the source line, and waits for you to confirm or cancel before it saves a plan.

## Hackathon description

EBYS helps when a spoken plan is easy to lose. You paste or select a short conversation. The app pulls out people, times, and tasks and lets you ask who or when in your own words. Each answer points at the line it came from. If a place or time was never said, it stays unknown. A later correction replaces the earlier plan, and the old line remains visible. You can edit, confirm, or cancel. A second confirm does not create a second plan.

Two things are easy to mix up, so the demo keeps them apart. Live questions can go to a real model on this machine (Cursor CLI). Sample mode does not. It is labelled “Sample · not real AI” and uses synthetic text only. Saving a plan can write the EBYS calendar on this computer, or hand you an `.ics` file. That is not the phone’s own calendar, and it is not an operating-system notification. Watch, 24-hour recording, and safety screens are simulated mockups.

There is no customer list, no revenue, and no health or emergency claim. EBYS does not call 119.

## Truth matrix

| Topic | Say this | Do not say this |
| --- | --- | --- |
| Live AI queries | New synthetic English text has been sent through the live Cursor CLI route. A lead capture at 12:00 KST (2026-11-09) recorded five uncached model calls with raw JSON and validation. An earlier English QA run also scored live who/when/where answers. | “Every screen is live AI.” “The model is end-to-end verified in the browser.” |
| Strict telemetry | Some API responses include route, model, cache flag, latency, raw model JSON, and validation. An independent audit of that one lead file marked those five calls PASS. Earlier QA runs were BLOCKED because raw JSON and validation were missing. | “Telemetry is complete on every path.” Fallback and duplicate ingests have no raw JSON, by design. |
| Calendar | Default server calendar mode is `simulated`. An EBYS-local file calendar can write `.data/calendar.json` on this computer and read it back. An `.ics` file is a handoff (`handed_off`), not proof the phone saved it. | “It is on the phone calendar.” “The operating system notified you.” |
| Data | Demo text is synthetic, or it must be explicitly consented. | Real patients, real families, or a live call recording. |
| Sample mode | A labelled sample path answers without a model. | Treating a sample answer as a live model result. |
| Source, confirm, cancel | Answers need a source quote. Confirm and cancel are separate. A cancelled proposal must not confirm the old plan. | A guess that fills a missing place, or a green success after a failed save. |
| UI | Opus 5.5 is redesigning the English mobile UI now. The previous layout is not the finished look. | “The new UI is done” or “judges already saw the final screens.” |
| Roadmap | Watch, 24-hour audio, and safety are simulated labels. Voice input is not the current MVP path. | A working watch, a medical result, or an emergency call. |

## Known limits (short)

- Node 24 or newer, local only. The model route needs the already-authenticated Cursor CLI. Quota or a config-file error can fall back to rules. Fallback is not a model answer.
- Latency on recorded live calls has been tens of seconds. That is not a speed promise.
- Phone OS calendar import and OS notifications were not verified on a device.
- Browser proof of the English-default redesigned UI is still in progress.
- Strict telemetry is not present on every historical run.
