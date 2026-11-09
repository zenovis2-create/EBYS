# Lead-ready targeted retest: independent acceptance

**QA idle. PASS for the requested five query cases and one EBYS-local calendar event.** This is API/file evidence, not final browser/device/full-product acceptance. Backend stayed at loaded SHA256 `4808156bf636ff452157af04ab244c8d9ed56743d7dad4b45a51f33f72a674ba`, startedAt `2026-11-09T04:27:25.704Z`, runtime actions-0.1.0, serverCurrent=true.

| Gate | Measured result |
| --- | --- |
| Prior AM/PM failures | **2/2 PASS**: seed-swap and Rowan's plant swap now retain known dates, ambiguous hours, exact source references and English “Is that AM or PM?”; time/startIso stay null until choice. |
| Absent facts | **3/3 PASS, found=false**: unknown seed-tin speaker, KO bus route, kiln serial number. |
| Independent model evidence | **9/9 PASS**, real reported cursor-cli/claude-sonnet-5-5-low, uncached, raw model JSON and validation objects retained. No model replay after the initial nine requests. |
| Independent local-calendar event | **PASS, 18/18 guards/matches**: source -> memory -> proposal -> bound preview -> one confirm -> file -> GET readback. |

## Exact local-calendar result

QA wrote a separate synthetic transcript (`qa/local-calendar/independent-230.txt`), not the lead's clinic scenario: Juno and Kai's copperplate printmaking lesson at Glass Meadow workshop, **2027-04-19 2:30 PM, Asia/Seoul**. Both utterances state 2:30 PM; the merged memory retains 14:30 and both quote spans. No time/person/place was manually patched to make the test pass.

- Memory `mem_16`, session `ses_5`, proposal `prop_2`, action record **`act_26a12f8f5755`**.
- File event ID `7100f16e8e`, UID `sj-eb10769d61b4aa980fe02892@ebys.local`.
- StartsAt: **2027-04-19T14:30:00+09:00**; local file alias `2027-04-19T14:30`; endsAt 15:30 (existing one-hour proposal duration).
- Title, person Kai, place Glass Meadow workshop and reminders `[60]` match across preview fields, confirm.readback, fresh `.data/calendar.json` read and `GET /api/readback/act_26a12f8f5755`.
- Confirm and GET readback: adapter calendar.local, mode real, status completed, verifyLevel **api_readback**, displayState **completed_external**.
- Preview explicitly says **“Saved to the EBYS calendar on this device (not your phone calendar)”**; readback identifies the EBYS calendar on this device and Seoul time/UTC+9.
- Before confirmation, no existing event had our intent ID or UID. One confirmation POST was sent. Existing file event was preserved exactly; total event count became two. The synthetic QA event remains for lead inspection; QA did not delete or cancel it, call notifications, reset state or restart anything.

## QA harness correction, transparently preserved

Initial run `qa/evidence/targeted-local-2026-11-09T04-36-08-903Z-98516/report.json` completed all five questions and local extraction, then stopped **before propose/confirm** because the QA selector looked at Memory.sessionId. The actual Memory carries meta.sessionId; the correctly merged 2:30 event was already present. This was a QA selection assumption, not a product minute regression.

The selector was corrected to require both the ingest's returned memoryIds and matching top-level-or-meta session identity. The original failed report and raw responses are unchanged and hash-linked by resumedFromSha256. `--resume` continued from that existing memory with **zero additional model requests**, and refused to run if the old attempt had already confirmed anything. The 2:30/source/value oracle was unchanged. Offline selector validation checks the meta shape and excludes another session.

## Provenance and scope

- Original nine model requests: before/after backend loaded/disk hashes match and serverCurrent=true. UI changed during that run; no stable final-UI claim is made.
- Resumed local confirmation: backend and UI hashes stable before/after, serverCurrent=true. UI hash `c5fb23d4a74ade39b38f8139573069cabebac0c2e4c2bba0d07c24974fb1a64c`. Parent Aside still owns visual E2E and recapture.
- Neither a physical phone/calendar, OS notifications, voice, deletion nor every confirm/cancel/idempotency scenario was tested here. `completed_external` is the app's contract state; the independently verified store is the **EBYS local JSON file only**.

## Separate follow-ups (do not misrepresent as tested)

- Saved event.sessionId is **null**. The inspected app/flow intentFor uses core.getMemory(...).sessionId, while the actual memory has meta.sessionId. Per-session purge/calendar deletion linkage needs owner review; QA did not invoke deletion to test it.
- English readback repeats **“with Kai with Kai”** because both model title and the person field include Kai. Exact field/time/readback acceptance passes; natural-copy polish remains a separate follow-up.

## Artifacts

Here: `report.json`, `acceptance-summary.json`, `runtime-before.json`, `runtime-after.json`, `calendar-before.json`, `calendar-file-target.json`, `confirm-response.json`, `readback-response.json`. Calendar snapshots preserve only our target event plus hashes/counts for unrelated events. The source nine raw model requests and original pre-stop runtime brackets remain in `qa/evidence/targeted-local-2026-11-09T04-36-08-903Z-98516/report.json` and adjacent files. No source artifact was overwritten.
