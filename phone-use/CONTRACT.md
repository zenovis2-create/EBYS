# Phone task panel: callback contract and wiring

Component: `ui/modules/phone-task-panel.js` (new, standalone; nothing else edited). Backend it displays: `adapters/phone-exec.mjs` (owner: sj-actions), reached through the existing Jarvis bridge `POST /api/exec` -> Aside -> use-phone. The panel holds no token, bridge address or credential. The browser talks only to the EBYS server; the server holds the bridge authorization.

## Mount (sj-ui)

```js
import { renderPhoneTaskPanel, createHttpPhoneTransport } from './modules/phone-task-panel.js';
const panel = renderPhoneTaskPanel({
  transport: createHttpPhoneTransport(),              // same-origin fetch to the 3 routes below
  task: { taskId, revision: 1, kind: 'open_calendar' }, // or later: panel.setTask(task)
  onPhase: (s) => {},                                  // {phase, task, preview, record, error} on every change
  onResult: (record) => {},                            // once, at a terminal backend status
  onCancel: () => {},                                  // user declined at the preview; nothing was sent
});
container.append(panel);            // panel.getState(), panel.setTask(t), panel.destroy()
```

Options: `lang` ('en' default; picks backend `{en,ko}` text), `pollMs` (2000), `maxPollMs` (120000). No CSS file: scoped `.sjphone` styles are injected once.

## Routes main must provide (not present in `server.mjs` yet)

| Route | Body | Calls | Returns |
|---|---|---|---|
| `POST /api/phone/preview` | `{task}` | `phone.preview(task)` | preview object, or `{ok:false,error}` |
| `POST /api/phone/confirm` | `{task, previewDigest}` | `await phone.confirm(...)` | record, or `{ok:false,error}` |
| `GET /api/phone/readback/:recordId` | none | `await phone.readback(id)` | record, or `{ok:false,error}` |

Returned JSON must be the adapter result unwrapped (the panel treats `ok:false` as an error, anything else as data). Wiring snippet and bridge/device injection: `adapters/PHONE-EXEC-HANDOFF.md`.

## What the panel requires and shows

- **Preview** must contain `previewDigest` and `exactPrompt`, else the panel refuses (it must show exactly what will be sent). It shows `display.task/device/risk`, `exactPrompt` verbatim, `willNot`, `modeLabel`, `permission`, `warnings`.
- **Confirm** happens only on the "Send to my phone" button, with the preview's digest. `stale_preview` -> automatic re-preview, fresh confirm needed. A network failure on confirm is shown as "Not sure it was sent" with a retry that is safe because the adapter queues one job per `taskId:revision`.
- **Status** polls `readback` while `executing`/`confirmed`. A queued job is never shown as success.
- **Success wording** only when `status === 'completed'` AND `verifyLevel === 'device_readback'`. `completed` without it shows "Reported done, but not checked". `verify_mismatch`, `unknown_outcome`, `failed` each have their own non-success wording. Unknown statuses are errors.
- **Result callback**: `onResult(record)` fires once with the backend record. Host code should decide on `record.status` and `record.verifyLevel`, never on "no error".

## Missing backend contract (exact)

1. `/api/phone/*` routes in main (above) and `EBYS_BRIDGE_TOKEN` in the server env, supplied by the owner. Without it the adapter returns `failed` / "Nothing was sent to your phone" (the panel shows that).
2. Adapter task kinds. The adapter validates only `open_calendar`; anything else returns `unsupported_task` and the panel shows it as unavailable. For the Calculator task (17*23 = 391) sj-actions must add a kind, for example `calculator_multiply {a:17,b:23}`, with a fixed safe prompt and an independent read-only readback: foreground package is a Calculator app AND screen text read by the device layer (not the agent) shows `391`. Until then it cannot be shown as verified.
3. Free-form user tasks: the adapter has no kind that forwards arbitrary text. If sj-actions adds one, it must keep `permission: 'guard'`, return `verifyLevel: 'none'` unless some independent readback exists (the panel will then show it as "not checked"), and keep the privacy blocks (no messages, calls, purchases, private chat reading).
4. Who creates the `task` object from the user's request (intent -> `{taskId, revision, kind}`): main/sj-actions. The panel does not parse text.
