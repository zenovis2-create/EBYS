# Independent English-default recheck

sj-qa, 2026-11-09 12:53 KST. Verdict: **PASS for HTTP/source/pure preference logic; actual fresh-browser rendering NOT RUN by QA.** Parent Aside owns visual E2E. No Chrome permission bypass or new browser/model/action calls.

- 11:26 default-source failures now **2/2 PASS**. Served HTML lang=en and initial i18n language en. Historical evidence unchanged.
- Total **11/11 PASS**: root live redirect, HTML/JS/CSS loading, two English-default source checks, explicit Korean redirect, explicit fixture entry, initial served-module language, empty-storage preference, malformed/blocked storage fallback, optional saved/explicit KO, stable runtime/source snapshots.
- `/` -> 302 `/?api=live`; `/?lang=ko` -> 302 `/?lang=ko&api=live`. No manual language override was used for the English entry.
- Served-module preference assertions used synthetic in-memory storage in Node, not a browser profile. No actual locale/device claim follows.
- Runtime version actions-0.1.0, loaded startedAt=2026-11-09T03:51:40.668Z; serverLoaded/serverOnDisk hash `8c8e675399c3d4fe5470103e79bc281c1261f7818438eef9d223580ac6c6aeb6`; uiOnDisk hash `0844b682b2c64f321647ea753df670871184bb1da73d68f81ff3babe1b9f5703`. Both runtime captures report serverCurrent=true and identical hashes.
- First attempt at 12:51:34 had only transport failures, preceding this observed server start. It cannot establish product/default failures. Raw attempt preserved; collector error classification corrected without editing those responses.
- `report.json` retains all ten raw GET responses, timestamps, content hashes and exact assertions. Code changes are QA-owned only. Final receipt validator regression suite: 18/18 PASS, including canonical root and explicit /ui/ live URLs.

No overall live AI, confirmation, calendar readback, accessibility or final release verdict is changed by this check. Use a parent Aside fresh-context capture to complete the visual English-default gate.
