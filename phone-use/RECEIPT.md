# Receipt: phone task panel (code + fake tests only)

Status: **component and contract shipped; NOT demonstrated on a phone.** Under `PHONE-EXCLUSIVE-CAPTURE.md` the Fold belongs to capture agent NlOEC0YdspIzzSRN until handback, so none of the following happened: no phone touch, no adb, no harness, no `/api/exec` call, no recording, no mic. No credential file was read. No existing file was edited.

## Files (all new)
- `ui/modules/phone-task-panel.js`: panel + `createHttpPhoneTransport`
- `phone-use/phone-task-panel.test.mjs`: 13 tests
- `phone-use/CONTRACT.md`, `phone-use/RECEIPT.md`

## Evidence
`node --test phone-use/phone-task-panel.test.mjs` -> 13 pass, 0 fail. The tests run the real `adapters/phone-exec.mjs` with fake bridge/device, covering: nothing sent before confirm; queued is not success; verified only with `device_readback`; agent-says-done-but-other-app is a mismatch; bridge 401 is an honest failure; unsupported task (Calculator) is refused; a lying `completed` without readback is shown as not checked; stale preview; double tap; retry after network failure; polling limit; cancel/destroy; HTTP transport adds no auth headers; source has no `innerHTML`/token/bridge address.

## Not proven
- Any real run, including Calendar open or Calculator 17*23 = 391.
- That main routes exist (`server.mjs` has no `/api/phone/*` or phone code) or that the bridge token is available to it.
- That the panel is mounted in the root UI (sj-ui).
- The Calculator task: the adapter only supports `open_calendar` (see CONTRACT.md, missing contract 2).
- Not run: the full `npm test` suite.

## To produce the live proof after handback
Main wires the 3 routes and token; sj-ui mounts the panel; in the browser: task -> exact preview -> "Send to my phone" -> the panel polls until the adapter's own `device_readback` says `completed`. The real Jarvis baseline run must not be relabeled as EBYS.

## Public-repository handoff

During final repository synchronization, the HTTP transport implementation was moved without behavior changes into `ui/services/liveApi.js` and re-exported from `ui/modules/phone-task-panel.js`, preserving the component API and the UI network boundary. `npm test` now includes this phone panel test file. Final offline checks: 282/282 unit/integration tests, 12/12 audit tests, and server syntax passed. These are offline/fake-device tests, not real EBYS-to-phone execution proof.
