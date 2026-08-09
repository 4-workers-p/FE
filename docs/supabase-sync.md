# GitHub → Supabase RAG 동기화

이 저장소의 `README.md`, `CLAUDE.md`, `docs/**/*.md`는 사내 RAG(질의응답 검색) 시스템의 `documents` 테이블(`source_type='github'`)로 자동 동기화됩니다. 동기화된 문서는 기존 `ingest` Edge Function이 자동으로 청킹·임베딩합니다.

## 동작 방식

```
push to master (README/CLAUDE.md/docs 변경)  ─┐
매주 월요일 03:00 UTC 스케줄 (전체 재점검)     ─┼─▶ GitHub Actions: sync-docs-to-supabase
workflow_dispatch (수동 실행)                 ─┘
                                                  │
                                                  ▼
                                     scripts/sync-to-supabase.mjs
                                                  │
                        1) 스크립트 상단에 하드코딩된 REPO_FULL_NAME / PATH_PATTERNS 사용
                        2) PATH_PATTERNS에 매칭되는 .md 파일 읽기
                        3) 파일별 git 마지막 커밋 시각/SHA 계산
                        4) 내용이 바뀐 파일만 documents 테이블 upsert (indexed_at=null)
                        5) 변경분이 있으면 ingest Edge Function 호출 (선택)
                                                  │
                                                  ▼
                                   ingest Edge Function이 Voyage로 자동 청킹·임베딩
```

- **push 트리거**: 실시간에 가깝게 반영하고 싶을 때
- **주간 스케줄**: push 트리거를 놓친 경우를 위한 안전망 (원래 목표였던 "주 1회 증분 저장"을 보장)
- 내용과 마지막 커밋 시각이 기존 저장값과 동일하면 upsert를 건너뛰어 불필요한 재임베딩을 방지합니다.

## 동기화 대상 설정 (하드코딩)

별도 관리 테이블 없이 [`scripts/sync-to-supabase.mjs`](../scripts/sync-to-supabase.mjs) 상단 상수로 직접 관리합니다.

```js
const REPO_FULL_NAME = "4-workers-p/FE";
const BRANCH = "master";
const PATH_PATTERNS = ["README.md", "CLAUDE.md", "docs/**/*.md"];
```

동기화 대상 파일/브랜치를 바꾸려면 이 상수만 수정하고 커밋하면 됩니다. (`dir/**/*.md` 형태는 해당 디렉터리 하위 모든 `.md`를 재귀적으로 포함합니다.)

## 필요한 GitHub Actions Secrets

저장소 Settings → Secrets and variables → Actions에 아래 값을 등록해야 워크플로우가 동작합니다.

| Secret | 필수 여부 | 설명 |
| --- | --- | --- |
| `SUPABASE_URL` | 필수 | Supabase 프로젝트 URL |
| `SUPABASE_SERVICE_ROLE_KEY` | 필수 | `documents` 테이블 upsert 권한 (RLS 우회) |
| `INGEST_FUNCTION_URL` | 선택 | 예: `https://<ref>.supabase.co/functions/v1/ingest`. 설정 시 변경분 발생할 때마다 즉시 청킹 트리거 |
| `INGEST_API_SECRET` | 선택 | `ingest` Edge Function의 `x-api-secret` 검증값 |

`INGEST_FUNCTION_URL`/`INGEST_API_SECRET`을 설정하지 않아도 동기화 자체는 정상 동작합니다. 이 경우 실제 청킹은 별도로 예정된 `ingest` 주기 실행(또는 수동 호출)을 기다립니다.

## 트러블슈팅

- 아무 것도 upsert되지 않았다면: 파일 내용/커밋 시각이 실제로 이전과 달라졌는지 확인 (변경 없으면 정상적으로 skip됨)
- `documents upsert 실패` 에러: `SUPABASE_SERVICE_ROLE_KEY`가 유효한지, `documents` 테이블의 `(source_type, external_id)` unique 제약이 그대로인지 확인
- Actions 로그의 `git log` 관련 에러: `actions/checkout`의 `fetch-depth: 0` 설정이 빠지지 않았는지 확인 (얕은 클론이면 오래된 파일의 마지막 커밋을 못 찾을 수 있음)
- 저장소를 옮기거나 이름을 바꾼 경우 `scripts/sync-to-supabase.mjs`의 `REPO_FULL_NAME`도 함께 수정해야 합니다 (안 바꾸면 `external_id`가 예전 이름 기준으로 계속 쌓입니다)
