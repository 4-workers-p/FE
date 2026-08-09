# GitHub → Supabase RAG 동기화

이 저장소의 `README.md`, `CLAUDE.md`, `docs/**/*.md`는 사내 RAG(질의응답 검색) 시스템의 `documents` 테이블(`source_type='github'`)로 자동 동기화됩니다.

**청킹은 GitHub Actions(이 워크플로우)가 직접 수행합니다.** 파일 하나를 문단 단위로 잘라 여러 `documents` row로 저장하고, `embed-documents`(구 `ingest`) 함수는 그 row들을 그대로 임베딩만 합니다. Voyage의 `enable_auto_chunking`으로 다시 쪼개는 건 이제 불필요합니다 (해당 함수 쪽에서 꺼두는 것을 권장 — 이 저장소 범위 밖).

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
                        4) 파일이 바뀌었으면 문단 단위로 청킹 (chunkText, 512자/64자 오버랩)
                        5) 그 파일의 기존 조각 전체 삭제(delete) 후 새 조각 전체 삽입(insert)
                                                  │
                                                  ▼
                                (각 조각이 documents의 별도 row. 청킹은 여기서 끝)
```

- **push 트리거**: 실시간에 가깝게 반영하고 싶을 때
- **주간 스케줄**: push 트리거를 놓친 경우를 위한 안전망 (원래 목표였던 "주 1회 증분 저장"을 보장)
- 파일의 마지막 커밋 시각이 이전과 동일하면(=변경 없음) 그 파일 전체를 건너뜁니다.
- 변경된 파일은 조각 개수가 이전과 달라질 수 있으므로, 기존 조각을 전부 지우고 새로 씁니다(부분 업데이트 아님).
- `indexed_at`이 `null`로 남은 조각은 `embed-documents` 함수가 별도로 실행될 때 임베딩됩니다 — 이 워크플로우는 그 실행을 트리거하지 않습니다.

## external_id / 조각 구조

한 파일은 여러 `documents` row로 쪼개져 저장됩니다.

```
external_id 형식: {repo}:{path}#{조각번호}
예) 4-workers-p/FE:docs/architecture.md#0
    4-workers-p/FE:docs/architecture.md#1
    4-workers-p/FE:docs/architecture.md#2
```

각 row의 `metadata`에는 `chunk_index`, `chunk_count`(그 파일이 총 몇 조각인지), `chunking: "pre-chunked-by-sync-script"`가 포함되어, 나중에 원본 파일 단위로 그룹핑하거나 순서대로 이어붙일 때 활용할 수 있습니다.

## 청킹 설정 (하드코딩)

```js
const CHUNK_SIZE = 512;      // 문자 수 기준
const CHUNK_OVERLAP = 64;
```

문단(빈 줄 기준)을 그리디하게 묶어 `CHUNK_SIZE`를 넘지 않게 채우고, 다음 조각 앞에 이전 조각 끝부분(`CHUNK_OVERLAP`)을 이어붙여 문맥 단절을 줄입니다. 문단 하나가 `CHUNK_SIZE`보다 크면 강제로 자릅니다.

## 동기화 대상 설정 (하드코딩)

별도 관리 테이블 없이 [`scripts/sync-to-supabase.mjs`](../scripts/sync-to-supabase.mjs) 상단 상수로 직접 관리합니다.

```js
const REPO_FULL_NAME = "4-workers-p/FE";
const BRANCH = "master";
const PATH_PATTERNS = ["README.md", "CLAUDE.md", "docs/**/*.md"];
```

동기화 대상 파일/브랜치를 바꾸려면 이 상수만 수정하고 커밋하면 됩니다. (`dir/**/*.md` 형태는 해당 디렉터리 하위 모든 `.md`를 재귀적으로 포함합니다.)

## 필요한 GitHub Actions Secrets

| Secret | 필수 여부 | 설명 |
| --- | --- | --- |
| `SUPABASE_URL` | 필수 | Supabase 프로젝트 URL |
| `SUPABASE_SERVICE_ROLE_KEY` | 필수 | `documents` 테이블 select/insert/delete 권한 (RLS 우회) |

## 트러블슈팅

- 아무 것도 안 바뀌었다면: 파일의 마지막 커밋 시각이 실제로 이전과 달라졌는지 확인 (변경 없으면 정상적으로 skip됨)
- `documents 삭제 실패`/`insert 실패` 에러: `SUPABASE_SERVICE_ROLE_KEY`가 유효한지, `documents` 테이블 권한(RLS)이 service_role에 열려 있는지 확인
- Actions 로그의 `git log` 관련 에러: `actions/checkout`의 `fetch-depth: 0` 설정이 빠지지 않았는지 확인 (얕은 클론이면 오래된 파일의 마지막 커밋을 못 찾을 수 있음)
- 저장소를 옮기거나 이름을 바꾼 경우 `scripts/sync-to-supabase.mjs`의 `REPO_FULL_NAME`도 함께 수정해야 합니다 (안 바꾸면 `external_id`가 예전 이름 기준으로 계속 쌓입니다)
- 적재는 됐는데 검색에 안 나온다면: `indexed_at`이 아직 `null`인 상태일 수 있습니다 — 별도로 `embed-documents` 함수를 실행해야 임베딩이 완료됩니다
