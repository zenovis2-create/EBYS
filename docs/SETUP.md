# Setup

## Requirements

- **Node.js 24 or newer** (`node -v`). The project declares `engines.node >= 24`.
- No `npm install`. There are no dependencies.
- For live AI only: the **Cursor CLI installed and already signed in** on this machine. EBYS does not sign in for you and never stores credentials. It runs the CLI in read-only ask mode (`--mode ask`) and never passes `--force`, `--yolo` or `--trust`.
- Optional, only to re-run the browser smoke test: Chrome.

## Start

```bash
cd senior-jarvis
npm test        # offline tests; makes no model calls
npm start       # EBYS listening on http://127.0.0.1:8787
```

Open `http://127.0.0.1:8787/`. A bare `/` redirects to `/?api=live`.

## Modes

| URL | Mode | Model call | Label in the app |
| --- | --- | --- | --- |
| `/?api=live` | Live (default) | Yes, through Cursor CLI | **Live AI** |
| `/?api=fixture` | Offline sample | No | **Sample · not real AI** |

Fixture mode is for looking at the design. It is a script, so it says nothing about answer quality.

If the CLI is missing or not signed in, live calls fail or fall back to labelled rules, and the app says so. Fix it by signing in with the Cursor CLI, then retry.

## Calendar mode

| `EBYS_CALENDAR` | What a confirmed plan does |
| --- | --- |
| `simulated` (default) | Stays in the app and is marked "Simulated · not really saved" |
| `local` | Writes an event to a JSON file on this PC, then reads it back |

```powershell
# PowerShell
$env:EBYS_CALENDAR = "local"
npm start
```

```bash
# macOS / Linux
EBYS_CALENDAR=local npm start
```

The default file is `.data/calendar.json`, which is git-ignored. Set `EBYS_CALENDAR_FILE` to use another path. The saved event can be checked with `GET /api/readback/<actionId>`, which reports `verifyLevel: api_readback`.

This is **not** your phone's calendar and it does not send OS notifications. Reminders appear only in the app, through `GET /api/notifications`.

## Environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `EBYS_HOST` | `127.0.0.1` | Listen address |
| `EBYS_PORT` | `8787` | Listen port |
| `EBYS_MODEL` | `claude-sonnet-5-5-low` | Model name passed to Cursor CLI |
| `EBYS_CALENDAR` | `simulated` | `simulated` or `local` |
| `EBYS_CALENDAR_FILE` | `.data/calendar.json` | Local calendar file |
| `EBYS_LLM_CACHE` | `.llm-cache` | Model response cache (git-ignored) |
| `EBYS_CURSOR_DIR` | auto-detected | Windows only: folder of the Cursor CLI version to use |

Keep `EBYS_HOST` on `127.0.0.1`. The app has no sign-in, so do not expose it to a network.

## Troubleshooting

- **A live answer takes a minute or two.** That is the real model call. The app shows progress.
- **Old answers return instantly.** The same prompt is served from `.llm-cache`. Delete that folder to force a fresh call. Telemetry shows `cached: true` for cache hits.
- **`spawn_failed` or `cli_exit`.** The Cursor CLI was not found or is not signed in.
- **Port in use.** Set `EBYS_PORT`.
- **Calendar page shows no events.** You may be in `simulated` mode. Restart with `EBYS_CALENDAR=local`.

## Reset

Stop the server, then delete `.data/` (local calendar) and `.llm-cache/` (model cache). Both are git-ignored and contain only synthetic data if you used the demo text.
