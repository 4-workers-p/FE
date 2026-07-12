# CommerceHub Frontend (commercehub-fe)

CommerceHub 고객용 쇼핑몰 웹 프론트엔드 저장소입니다. (관리자 어드민은 별도 저장소 `commercehub-admin`에서 관리하며 이 저장소 범위 밖입니다.)

> ⚠️ 이 저장소는 사내 RAG(검색 증강 생성) 시스템 테스트를 위한 **가상 프로젝트**입니다. 실제 서비스 코드가 아니라 문서 구조와 컨벤션을 검증하기 위한 목데이터입니다.

## 1. 프로젝트 개요

| 항목 | 내용 |
| --- | --- |
| 프로젝트명 | CommerceHub Frontend |
| 목적 | 고객용 자사몰 웹(PC/모바일 웹) 제공 |
| 운영 조직 | 커머스플랫폼팀 (프론트엔드 파트) |
| 배포 환경 | Vercel(스테이징) → AWS CloudFront + S3(운영) |
| 디자인 협업 | Figma, 사내 디자인 시스템 `Hubkit` |

## 2. 기술 스택

- **프레임워크**: Next.js 14 (App Router), TypeScript
- **스타일링**: Tailwind CSS, 사내 디자인 시스템 `Hubkit`(사내 npm 레지스트리 배포)
- **상태 관리**: 서버 상태 — TanStack Query, 클라이언트 전역 상태 — Zustand
- **폼/검증**: React Hook Form + Zod
- **테스트**: Vitest(유닛), Playwright(E2E)
- **빌드/배포**: GitHub Actions → Vercel Preview(PR) / CloudFront 무효화(운영 배포)

## 3. 폴더 구조

```
src/
├── app/                 Next.js App Router 라우트
│   ├── (shop)/product/  상품 목록/상세
│   ├── (shop)/cart/     장바구니
│   ├── (shop)/order/    주문/결제
│   └── (shop)/my/       마이페이지
├── components/
│   ├── ui/              Hubkit 래핑 컴포넌트 (버튼, 인풋 등 프리미티브)
│   └── domain/          도메인 조합 컴포넌트 (상품카드, 주문요약 등)
├── features/            기능 단위 로직 (hooks, api client, store)
├── lib/                 공통 유틸
└── styles/              전역 스타일, Tailwind 설정 확장
```

## 4. 로컬 개발

```bash
pnpm install
cp .env.local.example .env.local
pnpm dev
```

| 변수명 | 설명 |
| --- | --- |
| `NEXT_PUBLIC_API_BASE_URL` | 백엔드 gateway 주소 (로컬은 commercehub-be 로컬 gateway) |
| `NEXT_PUBLIC_CDN_URL` | 상품 이미지 CDN 주소 |
| `NEXT_PUBLIC_GA_ID` | 분석 스크립트 ID (로컬/스테이징은 비활성) |

## 5. 디자인 시스템 연동

UI 프리미티브는 직접 만들지 않고 `@commercehub/hubkit`을 우선 사용합니다. 디자이너와의 협업 프로세스(Figma 핸드오프, 토큰 동기화 규칙)는 [`docs/design-collaboration.md`](docs/design-collaboration.md)를 참고하세요.

## 6. 브랜치/배포 정책 요약

전체 내용은 [`docs/release-checklist.md`](docs/release-checklist.md) 참고. 요약:

- `main`(운영) / `develop`(스테이징) / `feature/*`, `fix/*`
- PR은 프론트 리드 또는 지정 리뷰어 1인 승인 필요, 디자인 변경이 포함되면 디자이너 확인(코멘트) 필수
- 운영 배포 전 반드시 Lighthouse 성능 점수 확인 (`docs/release-checklist.md` 3절)

## 7. 담당자

| 영역 | 담당 |
| --- | --- |
| 프론트엔드 리드 | 커머스플랫폼팀 프론트 파트장 |
| 디자인 시스템(Hubkit) | 디자인시스템팀 |
| 문의 채널 | Slack `#commercehub-fe` |

## 8. 관련 문서

- [`CLAUDE.md`](CLAUDE.md)
- [`docs/architecture.md`](docs/architecture.md)
- [`docs/coding-convention.md`](docs/coding-convention.md)
- [`docs/design-collaboration.md`](docs/design-collaboration.md)
- [`docs/domain-glossary.md`](docs/domain-glossary.md)
- [`docs/release-checklist.md`](docs/release-checklist.md)
