# phone.exec-bridge handoff (sj-actions -> main)

Scope: execution and readback for ONE scenario, "open Calendar on the Fold". Nothing else is claimed. Status: `claimStatus: 'unverified'` until a live run is recorded.

## Existing route (read-only inspection of `E:\jarvis-aside-bridge\server.js`; no credential file was read)
- `POST /api/exec` (lines ~841-853): body `{prompt, permission:'guard'}` -> `202 {runId, state:'running', ...}`. Runs `aside exec --account u1 --permission guard -- <prompt>`; the Aside agent uses use-phone. `full-access` needs `confirmFullAccess:true`; this adapter never sends it.
- `GET /api/runs` (line ~639): `{runs:[{runId,state,exitCode,tail,...}]}`; state `running|done|failed`.
- Auth (lines ~70-110, 603-606): every `/api/*` call needs `Authorization: Bearer <token>` with `Host: 127.0.0.1:18700` (admin token), or a paired-device token; mutating calls also need header `X-Jarvis: 1`. The bridge is listening on 127.0.0.1:18700 (checked). An unauthenticated `GET /api/runs` returned **401**.


## Auth without reading token.txt (server.js lines 580-594, 89-98)
Every `/api/*` route returns 401 without a principal, so some credential is unavoidable. The route that needs no file read by us is **device pairing**:
1. The owner runs the bridge's own `pair.ps1` once. It calls `POST /admin/pair` with the admin token and prints a one-time code (valid 300 s, single use). We never see the admin token.
2. Main redeems it on loopback: `GET http://127.0.0.1:18700/pair?c=<CODE>` with `redirect:'manual'`. The bridge replies `302` with `Set-Cookie: jb=<device token>`. Main keeps that device token in memory only (not on disk, not logged) and sends `Authorization: Bearer <device token>`.
3. Calls then pass as a paired device. POST also needs header `X-Jarvis: 1`; Node sends no `Origin`, which the bridge accepts.
Side effect: pairing adds a device entry to the bridge's `devices.json` (written by the bridge, not by us). The owner can remove it with `POST /admin/revoke?id=...`.
So it is possible without us reading `token.txt`, but it needs **one owner action** (run `pair.ps1`, hand the code to main, e.g. `EBYS_BRIDGE_PAIR_CODE` at server start). If the owner will not do that, that is the precise blocker.

## What I built (adapters/ only)
- `adapters/phone-exec.mjs`: `createPhoneExecAdapter({now, bridge, device})` -> `{preview(task), confirm({task, previewDigest}), readback(recordId), list(), describe()}`; `parseForegroundFromDumpsys(text)`.
- `adapters/phone-exec.test.mjs`: 12 tests (fakes only). Full adapters suite: **99/99 pass**.
- No network, process or credential code in `adapters/` (the static safety scan still passes). Main injects the transports below.

Task: `{taskId, revision, kind:'open_calendar'}`. Other kinds return `{ok:false, error.code:'unsupported_task'}`.

## Truth rules (enforced by tests)
- `confirm` returns `executing` / `verifyLevel none` (job queued is NOT success). `permission` is always `guard`.
- `completed` + `verifyLevel:'device_readback'` only if bridge run state is `done` AND an independent `device.foreground()` shows `com.samsung.android.calendar` or `com.google.android.calendar`.
- Agent says done but screen shows another app -> `verify_mismatch`. Screen unreadable -> `unknown_outcome`. Run failed -> `failed`. Bridge 401/unreachable -> `failed`, `pre_send`, "Nothing was sent to your phone".
- The baseline foreground app is captured at confirm; if Calendar was already open, the text says so.
- Same `taskId:revision` twice queues one job.

## Wiring for main (server.mjs; not applied by me). Updated 14:5x: ready-made injectable clients
`adapters/phone-bridge.mjs` holds the bridge client and the read-only adb check. They contain no network or process code; the server passes in the real `fetch` and `execFile`.
```js
import { execFile } from 'node:child_process';
import { createPhoneExecAdapter } from './adapters/phone-exec.mjs';
import { createBridgeClient, createAdbForeground } from './adapters/phone-bridge.mjs';

const phone = createPhoneExecAdapter({
  bridge: createBridgeClient({ fetchImpl: fetch, pairCode: process.env.EBYS_BRIDGE_PAIR_CODE }), // code from the owner's pair.ps1; loopback only
  device: { foreground: createAdbForeground({ execFileImpl: execFile, serial: process.env.EBYS_PHONE_SERIAL }) },  // read-only dumpsys; serial is private config, no default, never committed
});
// POST /api/phone/preview  {task:{taskId,revision,kind:'open_calendar'}} -> phone.preview(task)
// POST /api/phone/confirm  {task, previewDigest}                         -> await phone.confirm({task, previewDigest})
// GET  /api/phone/readback/:recordId                                      -> await phone.readback(recordId)   (UI polls while status === 'executing')
// GET  /api/phone/runtime                                                 -> phone.describe()
```
Rules baked into the clients: loopback base URL only (anything else throws), `permission` is always `guard` (full-access is refused locally), the pairing code is redeemed once, the device token stays in a closure variable and never appears in records or errors, and the adb check runs only `dumpsys activity activities`.
Record shape for the UI: `recordId, status (executing|completed|failed|verify_mismatch|unknown_outcome), verifyLevel ('device_readback' only when completed), readback {package, activity, checkedAt, source:'device_foreground', alreadyOpenBefore}, readbackText {en,ko}, error {code, phase, retryable, userHint}`. Show `readbackText.en`; show the exact `preview.exactPrompt` before confirm.
## Not done / not claimed
- No live run yet: I did not call `/api/exec`, did not launch Calendar, and did not send anything to the phone. Launching Calendar myself over ADB would skip EBYS confirm and would not prove product integration.
- Not claimed: saving OS calendar events, other apps, reliability beyond this single scenario.
