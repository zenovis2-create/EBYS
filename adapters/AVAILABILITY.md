# AVAILABILITY.md: which real calendar / notification routes exist (T12a)

Owner: sj-actions. Written 2026-11-09 (Asia/Seoul), read-only.

**How this was produced.** Registry reads, app-package listing, `Get-Command`, environment-variable *names* only (no values), and a list of local IPv4 addresses. No account login, no install, no network or API call, no `adb` command, no process started or stopped, no notification fired, nothing written outside `adapters/`. The phone-browser rows are general platform knowledge and have **not** been tested on any device.

Verdict key: **AVAILABLE** (seen on this machine) / **UNVERIFIED** (believed possible, never tested) / **BLOCKED** (needs an owner decision, account or install) / **NO** (not possible or not safe within this build).

## 1. This Windows machine (observed)

| Item | Observation | Meaning |
|---|---|---|
| OS | Windows 11 Pro | desktop only |
| `.ics` file handler | `.ics` is associated with a ProgId named "iCalendar File" (an AppX/packaged handler) | Opening an `.ics` on the laptop would launch some packaged app. **Which app, and whether it can import events, was not checked.** UNVERIFIED |
| Windows Mail & Calendar (`microsoft.windowscommunicationsapps`) | not installed | no built-in calendar app to import into |
| New Outlook for Windows | not installed | same |
| Classic `OUTLOOK.EXE` | no App Path registered | same |
| Chrome / Edge | both installed (Chrome `C:\Program Files\Google\Chrome\...`, Edge `...\Edge\Application\...`) | a Chromium browser exists for laptop-side demo. System default browser for http is a custom `AsideHTM` handler, not Chrome or Edge |
| System toast setting | `PushNotifications\ToastEnabled = 0` | Windows notifications look disabled for the user. A real desktop notification demo would probably not appear. UNVERIFIED, not tested (firing one would be a side effect) |
| Google / calendar / OAuth / VAPID env vars | none present (names scanned) | no credential for any real calendar API exists on this machine. We do not read other projects' secrets |
| `adb` | `platform-tools` 37.0.0 is installed (WinGet) and an `adb` server process is **already running** (started 2026-11-03, not by us) | We did NOT run `adb devices`: it talks to a shared server that another project may own, and a client/server version mismatch makes adb restart that server. Needs lead/owner OK. Whether any Android phone is attached is unknown |
| Network | Wi-Fi `10.225.50.170`; also WSL, Hyper-V Default Switch and a Tailscale address (`100.x`) | A phone on the same Wi-Fi could reach a LAN HTTP server. Tailscale or any tunnel would be an external service, so it is BLOCKED pending owner approval |
| Node | v24.22.1 | adapters are plain ESM with zero dependencies |

## 2. Route verdicts

| # | Route | Real? | Needs | Readback possible | Verdict |
|---|---|---|---|---|---|
| 0 | **EBYS local calendar** (`calendar.local`, adapted from the owner's bridge, see `calendar-local.mjs`) | **Real file write** on this device (`.data/calendar.json`), readback by re-reading the file (`api_readback`) | nothing: Node `fs` only | yes, from disk | **AVAILABLE**, demonstrated by unit tests in a temp directory (74 adapter tests). Label: "EBYS calendar on this device". It is **not** the phone's calendar, an OS calendar or a cloud account, and reminders appear only inside EBYS when polled (`dueNotifications`), not as phone notifications |
| 1 | **Simulated in-app calendar** (`calendar.simulated`) | No, simulated, labelled | nothing | in-app store only (`verifyLevel: none`) | **AVAILABLE**, demonstrated by unit tests only |
| 2 | **`.ics` file generation** (`calendar.ics-handoff`) | Real file, handoff | nothing | payload-level re-parse of our own file; **cannot** see any calendar | **AVAILABLE** (builder is unit-tested). Status is always `handed_off`, never `completed` |
| 3 | `.ics` import on a phone (iOS Safari "Add to Calendar", Android Chrome download then Calendar) | Real, user taps Save | phone browser reaching our server (LAN HTTP is enough for a file download) | none (user attestation at best) | **UNVERIFIED**. Needs a 10-minute test on a real phone. iOS may only download a Blob instead of showing the add sheet; Android typically needs a second tap. VALARM handling differs per client |
| 4 | `.ics` open on this laptop | Real handoff | the packaged iCalendar handler | none | **UNVERIFIED**. No Mail/Calendar/Outlook was found, so there may be nothing to import into |
| 5 | Google Calendar template URL (no OAuth) | Real handoff | phone or laptop logged in to Google | none | **UNVERIFIED**, would need a logged-in session (we do not log in) |
| 6 | Google Calendar API (OAuth, `events.insert` + `events.get`) | Real, would allow `api_readback` | Cloud project, consent screen, client id, redirect URI, user login | yes | **BLOCKED**: account integration, needs owner approval. No credentials exist. Not attempted |
| 7 | Android `intent://` link from Chrome (calendar insert / set alarm) | Real handoff | Android + Chrome | none | **UNVERIFIED**. Also forbidden-scheme guard: the adapters never emit `intent:` links today. Adding it needs lead sign-off and a guard change |
| 8 | Notification API / Service Worker local notification | Real, on the device that runs the page | **secure context**: HTTPS or `localhost`. LAN `http://10.x` is NOT secure, so it does not work for a phone on Wi-Fi | SW `show` log on the same device | **UNVERIFIED** and **BLOCKED for phones over LAN HTTP**. Works only on the laptop via `localhost`, and Windows toasts appear disabled (see above). Not implemented |
| 9 | Web Push (VAPID) | Real | HTTPS endpoint reachable from the phone, a server dependency, VAPID keys, iOS needs an installed PWA | `show` log | **BLOCKED** (needs tunnel/HTTPS and a dependency; owner approval) |
| 10 | `adb reverse` to give a USB-connected Android phone a `localhost` secure context | Real | USB debugging, the shared adb server, a device | n/a | **UNVERIFIED / BLOCKED**: depends on item "adb" above (shared server, device unknown) |
| 11 | Notification **preview** (`notification.preview`) | No, simulated | nothing | none | **AVAILABLE** (pure list). Always badged PREVIEW, never an OS notification |
| 12 | Watch notification | No | n/a | n/a | **NO**: only a labelled simulated mockup belongs to `ui/`/`mockup/` |
| 13 | Native Android/iOS write (CalendarContract, EventKit, Reminders) | n/a | native app toolchain | n/a | **NO** in this window |
| 14 | Anything that calls, texts or emails a person, or dials 119 | n/a | n/a | n/a | **NO**, never. The adapter layer has no such action; tests enforce it |

## 3. Honest bottom line for the demo

1. What can truthfully be shown **today**: the full preview, confirm, execute, readback flow with the **simulated** calendar (labelled SIMULATED) and an **`.ics` handoff** that is generated and parse-checked, with status `handed_off` and text "Not added to your calendar yet".
2. What cannot be claimed without a real-device test (item 3): that a phone's calendar actually imports the file. Until a test with evidence exists, the label stays `unverified`.
3. No real calendar write and no OS notification is available through any route that needs no login, install or approval. Anything beyond items 1, 2 and 11 needs an owner decision.

## 4. Decisions needed from lead / owner (none taken here)

- May sj-actions run `adb devices` (read-only) against the already-running shared adb server? Or should it stay untouched?
- Is there a real phone for a 10-minute `.ics` import test over LAN HTTP, and is a person available to tap Save on it?
- Is any account integration (Google OAuth) or tunnel/HTTPS service approved? Default: no.
- Should Windows notifications (currently reported disabled) matter for the demo? Default: no, because notifications are shown only as a labelled preview.
