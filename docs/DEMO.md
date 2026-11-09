# Demo walkthrough

A five-minute walk through the real app. Everything uses **synthetic** text. Nothing is sent to anyone, and nothing leaves this PC except the prompt that goes to the Cursor CLI model.

Before you start, follow [SETUP.md](SETUP.md). For the full path, start with `EBYS_CALENDAR=local` and make sure the Cursor CLI is signed in. Open `http://127.0.0.1:8787/`.

> Live model calls take roughly 20-140 seconds each. That wait is real. The app shows progress, and a recording should show the wait too, not cut it out.

## 1. Home

Check the pill at the top says **Live AI**. If it says **Sample · not real AI**, you are in fixture mode (`/?api=fixture`). Switch to `/?api=live` for the real demo.

The Home screen shows the mascot, a time-aware greeting, **Talk to EBYS**, and three shortcuts: **My plans**, **Add a memory**, **Find a memory**. The bottom bar is **Home / Chat / Memory / Settings**.

## 2. Add a memory

Tap **Add a memory**, tick the consent box, and paste this synthetic conversation:

```text
Juno: The copperplate printmaking lesson with Kai at Glass Meadow workshop is on 2027-04-19 at 2:30 PM.
Kai: Yes, keep that printmaking lesson on 2027-04-19 at 2:30 PM at Glass Meadow workshop.
```

EBYS sends it to the model and returns a memory with who, when and where. The text on the screen is only what you pasted. The microphone stays off.

## 3. Ask, and check the source

Open **Chat** and ask:

> When is the printmaking lesson, and where?

The answer shows the date, the time and the place. Each slot has a **Source**: the exact line from the conversation. Open it and compare with what you pasted.

## 4. Ask for something that was never said

Ask:

> What is the bus route to the workshop?

Expected: EBYS says it does not have that in your conversations. It does not invent a route. (The recorded runs include this case and similar ones, each returning `found=false`.)

## 5. Unclear time: AM or PM

Paste a second conversation where the hour is unclear. This example is illustrative: the recorded QA cases were similar, but this exact text was not run.

```text
Rowan: Let's swap the plant on Friday, around 3.
```

Make a plan from it. EBYS asks **"Is that AM or PM?"** and shows choices that say AM or PM. None is preselected, and no time is stored until you choose.

## 6. Preview, then confirm

From the printmaking memory, choose **Make it a plan?**. The preview lists the title, person, place, date, time and reminder, in **Seoul time (Asia/Seoul, UTC+9)**, with the source it came from.

- **Cancel** closes the proposal. A cancelled proposal cannot be confirmed afterwards.
- **Yes, confirm** saves exactly what the preview showed.

In `simulated` mode the result says **Simulated · not really saved**. In `local` mode, the result says it was saved to the **EBYS calendar on this device (not your phone calendar)**.

## 7. My plans

Open **My plans** from Home. This screen is being wired to the saved local calendar by the UI owner. Until that is confirmed in a live run, treat the saved event as verified through the API, not through this screen.

## 8. Check the saved event through the API

In `local` mode, the confirmation returns an action id such as `act_...`. Read it back:

```bash
curl http://127.0.0.1:8787/api/readback/<actionId>
```

Look for `adapter: calendar.local`, `mode: real`, `status: completed` and `verifyLevel: api_readback`. The event is also in `.data/calendar.json`.

For the printmaking example, the independent QA run recorded a start of `2027-04-19T14:30:00+09:00` in the file, in the preview and in the readback. See `qa/evidence/targeted-local-2026-11-09T04-42-20-836Z-180200/REVIEW.md`.

## 9. Settings

Open **Settings** to see the language (English by default, Korean optional), privacy information and what this build does not do.

## What this demo does not show

- A phone calendar entry or an OS notification. Neither exists in this build.
- Voice input as a tested feature. It is optional and browser-dependent.
- Real calls, messages, emergency calling, watch, glasses, safety monitoring or 24-hour audio.

## Recording notes

- Record only the live app on `/?api=live`, and keep the synthetic text visible.
- State plainly that the calendar is a local file on this PC.
- Never show real personal data, credentials or terminal windows containing secrets.
- The final approved video link will be added to the README when it is delivered. Until then, there is no demo video.
