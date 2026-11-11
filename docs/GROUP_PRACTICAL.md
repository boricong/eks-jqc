# 그룹 실기 시험운영

2026-11-11 구현 기준. 기존 선택형 평가·Auditor·객관식 재인증은 유지한다. 그룹 실기는 일반 자격의 취득/재취득에 사용하는 **별도 인증Set 방식**이다. 서버는 업무32와33을 읽으며, 모든 현행 클라이언트의 쓰기 계약은6이다. 업무32는 자동으로33으로 이관하지 않는다.

## 적용 범위와 업무 순서

1. 별도 시험 데이터에 업무33 이관을 적용하고 `EKS_GROUP_PRACTICAL_MODE=trial`로 서버를 시작한다. 기본값은 비활성이다.
2. 인증Set 편집에서 ‘그룹 실기 전용 · 시험운영’을 선택한다. 수행 지침, 외부 분석 방법, 공동 판정 기준, 필수 결과 항목(숫자/문자·단위)을 입력한다. 기준 변경은 기존 메이저·마이너 버전 규칙을 따르고 실기 방식/결과 기준 변경은 메이저에 반영된다. 과거 배정의 내용과 해시는 유지한다.
3. 개인 계획을 완료해 **같은 팀·같은 인증Set 버전의 수강**을 준비한다. 그룹 생성으로 개인 계획이나 배정을 만들지 않는다. 팀 관리자 또는 해당 팀을 선택한 시스템 운영자가3~4명과 평가자를 지정한다. 평가자는 구성원이 아닌 활성 팀 관리자여야 한다.
4. 그룹 시작으로 구성원·개인 수강·인증Set 내용 해시를 고정한다. 구성원당3회, 총9/12개의 수행 기록을 만든다. 지정 평가자가 수행일, 원자료와 자료 내 위치, 메모, 완료 여부를 기록한다.
5. 원자료 CSV/XLSX와 외부 분석 보고서 PDF를 등록한다. Minitab 등 외부 도구에서 분석한 결과값을 필수 항목에 입력하고, 원자료 대조 확인·판정 사유·Pass/Fail을 저장한다. 시스템은 통계값이나 합격 여부를 자동 계산하지 않는다.
6. ‘판정 검토’에서 전원 수료와 개인별 자격 발급 영향을 확인한 뒤 확정한다. Pass는 전원의 해당 인증Set 수료를 같은 트랜잭션에 기록한다. 다른 필수 인증Set이 남으면 자격은 발급하지 않는다. 그룹 근거로 발급한 인증은 `trial: true`이며 화면·인쇄 본문에 시험 발급을 표시한다.
7. Fail은 동일 구성원·동일 버전으로 새 평가 차수를 만들고 모두3회 다시 수행한다. 이전 수행·분석·판정은 남는다. 구성원을 바꿔야 하면 기존 그룹을 사유와 함께 종료하고 새 그룹을 만든다.
8. 확정 판정은 덮어쓰지 않는다. 구성원이 아닌 관리자가 사유·영향 검토 후 무효화한다. Pass 수료는 이력을 보존한 채 효력을 잃고 파생 인증은Revoke, 연결 취득 절차는종료된다. 해당 인증의 진행 재인증도 종료하며, 남은 유효 대상이 없는 재인증 회차와 배정도 종료한다. 다시 취득할 때 새 개인 계획이 필요하다. 무효화한 Fail은 새 차수로 재시험할 수 있다.

구성원은 본인의3회 완료 상태와 공동 판정만 조회한다. 다른 사람의 수행 기록·원자료·분석 결과값은 제공하지 않는다. 관리자/지정 평가자 화면은 `인증 업무 관리 → 그룹 실기`, 개인은 자격 평가 화면 또는 결과 알림에서 이동한다. 미저장 입력은 화면 이동 시 확인하며 서버 저장 실패/충돌 시 보존한다.

## 검토 계약

| 구분 | 내용 |
|---|---|
| 입력 | 전원3회 수행 근거, 지정 평가자, 동결 기준, 원자료 해시, 필수 분석 결과값, 보고서, 대조 확인, 사유와Pass/Fail |
| 출력 | 그룹 공동 판정, 각 개인의 수료, 남은 조건을 만족한 개인만 시험 자격 발급, 감사·알림 |
| 보류 | 누락/잘못된 값 유형, 원자료 변경·손상·소실, 다른 버전/수강 연결, 구성원 권한·소속·업무 제한, 취득 종료·제외, 평가자 권한 상실, revision/검토 토큰 충돌 |
| 원자성 | 직렬 쓰기 대기열에서 최신 권한/전체 조건을 재검사하고 전원 결과·수료·발급·알림·요청 영수증을 단일JSON 교체로 저장 |
| 재시도 | 동일 actor와Idempotency-Key/동일 요청은 기존 응답 반환, 같은 키의 다른 본문은409 |

수행 기록에는 개별revision을 두어 다른 사람의 행을 저장한 이유만으로 충돌시키지 않는다. 분석 저장은 평가 차수revision과 원자료sourceHash를 확인한다. 수행 기록 수정은 기존 분석을 이력으로 옮기고 재등록을 요구한다. 최종 검토 토큰에는 그룹·차수revision, 분석, 구성원 상태와 조직revision, 발급 영향을 포함한다. 검토 후 변경되면 재검토한다. Fail 후 평가자 권한이 없어져도 관리자가 다음 차수 평가자를 교체할 수 있고 이전 판정자는 보존된다.

## 파일과 백업

- 파일당 기본20MiB, 차수당20개. `EKS_GROUP_FILE_MAX_BYTES`(최대100MiB), `EKS_GROUP_FILES_PER_RUN`(최대100)로 서버 시작 시 설정한다.
- 파일 본문은JSON에 넣지 않는다. `${EKS_DATA_FILE}.group-files/<SHA256>`에 스트리밍·크기 검사·파일 동기화 후 보관하고JSON에는 크기/해시/등록자/그룹/차수만 기록한다. CSV/XLSX/PDF 확장자와 기초 파일 시그니처를 검사한다. XLSX/PDF를 실행하거나 통계 분석하지 않는다.
- 업로드와 메타데이터 확정 사이 실패가 나면 참조 없는 파일이 남을 수 있다. 자동 삭제하지 않는다. 운영 중 참조 파일, 과거 자동/수동 백업에 필요한 파일을 삭제하지 않는다. 저장 공간을 관찰하고 별도 보존/정리 정책 없이 직접 삭제하지 않는다.
- 서버 시작, 다운로드, 판정 검토/확정, 수동 백업과 복구에서 실제 파일 크기·SHA256을 검증한다. 자동JSON 백업은 같은 불변 파일 저장소를 참조한다.
- 업무33의 `npm run data:backup`은 업무JSON, `.files/manifest.json`과 파일, `.organizations.json`, `.maintenance.json`, `.bundle.json`을 함께 생성한다. `.bundle.json`은 세JSON의 해시와 근거 파일 수를 기록한다. 출력된 업무 백업JSON과 이 이름으로 시작하는 동반 파일/폴더를 함께 보관한다. 일반 조직 백업도 기존대로 출력한다.
- 서버를 중지한 뒤 `npm run data:restore-group -- /절대경로/manual-....json`으로 묶음을 복구한다. 모든 근거 파일과 세JSON을 확인한 뒤 업무/조직/관리 정보를 잠금·사전 백업·이관 표식 아래 교체하고 세대 식별자를 새로 발급한다. 저장 실패는 세 원본을 복구한다. 재시작 후 계정을 다시 선택한다.
- 묶음 복구는 기존 업무/조직JSON을 읽어 revision·해시를 조건으로 잠근다. 현재JSON 자체를 읽을 수 없거나 복구 도중 프로세스가 중단되어 `.policy-migration.json` 표식이 남으면 서버를 시작하지 말고 표식의 업무·조직·관리 백업을 같은 시점으로 복구한다. 기존 [데이터 운영](MASTER_DATA.md)의 보존 복구 절차를 따른다. 일반 `data:restore`는 업무JSON과 그 근거 파일만 복구하므로 그룹 시험환경 전체 복원에는 `data:restore-group`을 사용한다.

## 별도 시험환경 활성화

실제 업무 파일에 적용하지 않는다. 별도 디렉터리에 업무32·조직5·관리 정보를 복사하고 그 복사본의 절대 경로를 `EKS_DATA_FILE`로 지정한다. 조직 파일 경로는 기존 저장소 규칙을 그대로 따른다. Node24에서 서버를 중지한 상태로 실행한다.

```sh
export EKS_DATA_FILE=/별도시험환경/runtime/state.json
npm run data:backup
npm run data:migrate-group-practical -- --trial --dry-run
```

dry-run이 출력한 `expectedRevision`, `stateHash`, `organizationHash`를 그대로 사용한다.

```sh
npm run data:migrate-group-practical -- --trial --apply \
  --expected-revision=<expectedRevision> \
  --expected-sha256=<stateHash> \
  --organization-sha256=<organizationHash>
export EKS_GROUP_PRACTICAL_MODE=trial
npm start
```

이관은 과거 인증Set 내용·동결 해시·수행·수료·발급 근거를 다시 만들지 않는다. 같은 업무33 시험 데이터에 재실행하면 무변경이다. 새 그룹 기록이 생긴 후에는 기능을 비활성화하고 호환 코드를 유지하며 수정한다. 옛 업무32 백업으로 되돌리면 이후 기록이 없어지므로 단순 롤백하지 않는다. 비활성 상태에도 기존 그룹 이력 조회는 유지한다.

## API

모든 API는 기존 세션/데이터 세대 검사를 사용한다. 쓰기는 `X-EKS-Release-Contract: 6`과 `Idempotency-Key`를 사용한다. 그룹 데이터는 `shared/src/group-practical.ts`의 계약을 따른다.

| 경로 | 동작 |
|---|---|
| `GET /api/group-assessments/status` | 사용 여부·파일 제한 |
| `GET /api/group-assessments/candidates?lv1OrganizationId=...` | 관리 팀의 정확한 버전별 수강·평가자 후보 |
| `GET/POST /api/group-assessments` | 권한 범위 목록/그룹 지정 |
| `GET /api/group-assessments/:id` | 관리자 상세 또는 본인 수행만 남긴 조회 |
| `POST /api/group-assessments/:id/start, retry, evaluator, close` | 시작·재시험·평가자 교체·종료(각각 별도 경로) |
| `POST /api/group-assessments/:id/runs/:runId/trial, analysis` | 수행 기록/외부 분석 결과 저장 |
| `POST /api/group-assessments/:id/runs/:runId/preview, finalize` | 전원 조건 검토/공동 판정 확정 |
| `POST /api/group-assessments/:id/runs/:runId/invalidate-preview, invalidate` | 무효화 영향/확정 |
| `POST /api/group-assessments/:id/runs/:runId/files?name=...&kind=raw\|report` | `application/octet-stream` 파일 등록 |
| `GET /api/group-assessment-files/:fileId` | 권한 검사 후 첨부 다운로드 |

## 검증과 운영 경계

`server/tests/group-practical.test.ts`는3/4명 수행, 전체 반영/다른 필수 조건, Fail/무효화, 권한/보류, 충돌/재시도, 실패 복구, 개정 API, 실제 이관CLI·백업 묶음을 검증한다. `frontend/tests/group-practical.spec.ts`는 기준 편집, 그룹 생성·근거 업로드·전원 판정·개인 조회·무효화, 입력 보존과 네 화면 폭을 검증한다.

```sh
node --import tsx --test server/tests/group-practical.test.ts
EKS_GROUP_LOAD_TEST=1 node --import tsx --test server/tests/group-practical-load.test.ts
npm run test:e2e -w frontend -- group-practical.spec.ts
```

2026-11-11 Node24 로컬 부하 시험: 완료Fail 이력1,000차수·진행20그룹·동시 평가자5명, 메타데이터 약4.2MB에서 조회p95 152ms, 확정p95 827ms. 목표는 각각1초/2초이며 전체JSON 자동 백업·직렬 대기 시간을 포함한다. 작은 공유 근거 파일을 사용하는 합성 데이터이고 대용량 업로드·수동 백업·실제 전체 운영 데이터의 처리량을 보장하지 않는다. 기본 회귀에서는 이 부하 시험을 건너뛰고 위 명령으로 별도 실행한다.

현행 계정 선택은 실제 신원 인증이 아니다. 이번 범위는 단일 서버의 별도 시험운영이며 공식 인증 전환,SSO/실제 평가자 신원 연결, 대규모/다중 서버, 통계 분석의 타당성 검증과 Minitab 자동 연동은 포함하지 않는다. 판정자 식별·파일 보존·복구 및 실제 예상 데이터 부하를 확인한 뒤 공식 운영 범위를 별도로 결정한다.
