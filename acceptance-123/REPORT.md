# EBYS 1/2/3 적용 독립 감사

관찰: 2026-11-09 10:55–10:58 KST. 제품은 기존 sj-memory/sj-ui/sj-actions/lead 소유. 이 감사는 새 acceptance-123/ 폴더만 작성했으며 기존 제품 파일을 수정하지 않았다.

## 판정

완료 아님. 1/2/3 기본 구조는 구현되어 있으나 두 개의 결정적 core 회귀 실패와 하나의 UI/core 형식 통합 위험이 남았다. 총괄 Aside 5GCW81A8SLVUvJ7x에게 정확한 재현과 owner 수정 요청을 전달했다.

- 1: 추출 단계의 원문 인용 검증, 이름/장소 부분문자열 검증, 누락 슬롯 null, 출처 offset 검증은 PASS. 질의 direct slot의 값-인용 연결은 FAIL.
- 2: 원문/파생 기억 분리, 취소 이력, 상호 supersede 링크, 확정된 기억 변경의 pending 처리는 PASS. 취소된 원본을 가리키는 기존 제안의 확정은 FAIL.
- 3: FIXTURE 브라우저에서 Evidence/Clarify/Confirm과 미선택 오전/오후 차단은 PASS. live core 객체 후보를 UI가 읽는 부분은 통합 보완 필요.

## 재현 및 근거

명령: `node --test --test-reporter=tap acceptance-123/audit.test.mjs`
기준선: `baseline.tap`: 12 tests / 10 pass / 2 fail. 모델은 명시적으로 SYNTHETIC-FAKE-LLM / NOT-A-LIVE-MODEL이며 격리된 메모리 저장소만 사용한다. mode=model은 코드 분기를 시험한 표시일 뿐 실제 모델 호출 증거가 아니다. 공유 서버, 계정, 캘린더, 알림, 폰, 기존 데이터 reset은 하지 않았다.

### GAP-1: 진짜 인용으로 무관한 장소 값을 정당화

위치: core/core.mjs answerFrom, 관찰 시 L383–390; core/schema.mjs validateQuery.
재현: 저장 원문 `산책하고 왔어.`. fake query의 where={value:'중앙병원',quote:'산책하고 왔어.',utteranceId:'utt_1'}, memoryIds=[]. 결과 where.state='known', display='중앙병원'.
기대: 근거에 없는 who/where 값은 unknown/null 또는 확인 요청. 원문 인용의 실제 존재만으로 값이 뒷받침된다고 판단하면 안 된다.
최소 수정 제안: 추출 validator와 동일하게 normName 기반 who/where 값 포함 여부 검사. title/what 요약은 별도 의미 검증 범위로 구분. 기존 정당한 query 동작 회귀도 확인.

### GAP-2: 취소된 기억의 기존 제안이 확정 가능

위치: core/core.mjs applyState L194 및 markConfirmed L599 부근.
재현: event ingest -> propose(mem_1) -> cancel ingest(target mem_1) -> markConfirmed(prop_1, unchanged revision). 원본 memory는 cancelled이나 반환 proposal.state='user_confirmed'.
기대: 기존 제안을 expire/invalidate하거나 확정 시 모든 sourceMemoryIds의 현재 상태/버전을 재검증해 거부. superseded/retracted도 함께 점검. 이미 user-confirmed인 기억의 pending 변경 정책은 유지.
주의: 이는 core 경계의 재현이며 실제 캘린더 부작용이 일어났다는 주장은 아니다. 현재 adapter intent는 proposalState만 전달하므로 lead API 단계 검증도 점검 필요.

### GAP-3: UI가 live core의 객체 시간 후보를 무시

소스 대조 근거:
- core/time.mjs buildWhenSlot: when.value={date,time,startIso,...}; candidates=[{date,time,startIso,labelKo,labelEn}].
- ui/screens/proposal.js toForm L126 부근: when.value가 string인 경우만 기존 날짜 추출.
- 같은 파일 candidatesFor L140–146: cnd가 string인 경우만 parseIso. 객체 후보는 모두 생략.
- ui/services/liveApi.js: 응답 envelope만 unwrap, 이 형식의 변환 없음.
기대: 기존 string 및 object 후보를 둘 다 수용해 `.startIso`, `.date`를 읽고, 오전/오후는 사용자가 명시적으로 선택하게 유지.
판정: 소스에서 확인한 통합 위험. 실제 lead server와 연결한 브라우저 E2E로 재현한 것은 아님.

## 화면 확인

별도 읽기 전용 localhost:8793 서버에서 ui/ 및 contracts/ GET만 허용. `?fast=1`, 기본 fixture 모드. API 경로가 없어 공유 시스템과 분리됨. 412×915 모바일 뷰.

1. 내장 합성 병원 예시만 분석.
2. 이전 금요일 일정은 바뀐 기억, 목요일 3시는 오전/오후 모름으로 표시.
3. 근거 drawer에 실제 발화자/인용/원문 하이라이트/원문 일치 확인.
4. 일정 제안에 아직 저장되지 않았음을 표시.
5. 시간 없이 저장 진행 시 시/분/오전오후 선택 경고로 차단.
6. 후보를 눌러도 오전/오후를 자동 확정하지 않으며 별도 오후 선택 후 확인 카드로 이동.
7. 마지막 확인 카드에 사람/날짜/시간/장소/행동 및 시뮬레이션 경고 표시. 최종 `네, 확인해요`는 누르지 않음.

증거(사용자용 artifact가 아닌 세션 tmp):
- C:/Users/User/.aside/u/1/sessions/2026-11-08_tZovN0BnTgTIArG2/tmp/ebys-evidence.webp
- 같은 폴더 ebys-clarify.webp, ebys-confirm.webp

UI 기준선 기존 단위 테스트: 15 pass / 0 fail. 이 결과는 fixture/계약 단위 동작이며 live 모델 정확도나 외부 실행 완료를 증명하지 않는다.

## REUSE-MANIFEST 실증 판정

관찰한 manifest의 Validation evidence는 아직 비어 있다. R1/R2/R4/R6은 assigned, R5/R7은 inspected이므로 채택/복사/실제 동작 검증으로 승격할 수 없다.

- R1: core.summarizeWindow는 존재하며 SIMULATED CLOCK / no background 2h scheduler로 명시. 독립 테스트는 출처/기억 동작을 확인했지만 bridge prompt 코드의 실제 복사/계보를 입증하지 않는다.
- R2: 현재 core/에서 요청 분류기 적용 근거를 확인하지 못함. '현재 파일에서 미확인'이지 영구 부재 판정이 아님.
- R3: llm/router.mjs extractJson 존재. fenced JSON 및 괄호 추출 구현은 확인했지만 think-tag 특화 처리나 소스 복사 sha256·테스트 근거는 미확인. equivalent/adapted 주장을 actual copied code와 구분해야 함.
- R4: 현재 calendar-adapters.mjs는 in-memory simulated 및 ICS handoff뿐이며 주석도 network/filesystem 없음이라고 명시. calendar.local 파일 readback·atomic rename·실제 reminder sweep 완료로 표현하면 안 됨.
- R5: 공유 STT 서비스 health/사용 승인 여부를 이 감사에서 확인하지 않았고 사용하지 않음.
- R6: 관찰 UI 파일에서 speechSynthesis/ko-KR read-aloud 구현 근거 미확인. ko-KR 날짜 포맷은 TTS가 아님.
- R7: roadmap only, 폰 캘린더 반영 주장 없음.

원본 E: 프로젝트/실제 source hash/커밋은 이 감사에서 열지 않았다. 따라서 manifest의 출처 소유권, 복사 이력, 행사 시작 시점 신규 개발 주장은 이 감사의 독립 검증 범위 밖이다. 현재 코드 판정용 해시는 baseline-hashes.json에 기록.

## 다음

기존 owners가 GAP-1/2를 수정하고 GAP-3 형식 정합성을 해결한 후 같은 12개 검사를 다시 실행. 실제 모델과 lead API의 정확도, 확인 게이트, 저장/삭제/권한은 기존 independent QA 담당자의 E2E에서 별도로 확인. 현 상태를 적용 완료로 보고하지 않는다.

## 인계 및 정리 (11:00 KST)

기존 총괄 5GCW81A8SLVUvJ7x와 기존 10분 감독 부모 g2cUyYVbjCJYZr1M에 동일 검사 재실행 경로 전달. 추가 단발 예약은 active routine 3개 상한 때문에 생성되지 않았으며 기존 예약이나 요금제를 변경하지 않았다. 담당자 수정 콜백 또는 기존 감독의 재검사를 기다리는 상태다. 감사용 localhost8793 서버 및 배경 탭은 종료. 화면 증거만 tmp에 보존.
