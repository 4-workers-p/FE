# 아키텍처 가이드 (commercehub-fe)

## 1. 렌더링 전략

| 페이지 | 전략 | 이유 |
| --- | --- | --- |
| 상품 목록/상세 | SSR + ISR(재검증 60초) | SEO 중요, 재고/가격 변동을 준실시간 반영 |
| 홈/기획전 | ISR(재검증 5분) | 트래픽 집중, 캐시로 서버 부하 절감 |
| 장바구니/주문/마이페이지 | CSR (클라이언트 컴포넌트) | 개인화 데이터, SEO 불필요 |
| 검색 결과 | SSR | 검색어별 SEO 및 최신성 필요 |

## 2. 데이터 페칭 계층

```
app/(shop)/product/[id]/page.tsx  ─ 서버 컴포넌트, 초기 데이터 fetch
        │
        ▼
features/product/api.ts           ─ API 클라이언트 (fetch 래퍼, 에러 정규화)
        │
        ▼
gateway (commercehub-be)
```

클라이언트에서 추가 상호작용(옵션 변경 시 재고 재조회 등)이 필요한 부분만 `features/product/hooks.ts`의 TanStack Query 훅으로 분리합니다.

## 3. 상태 관리 원칙

- **서버 상태**(상품, 주문, 회원 정보): TanStack Query. `staleTime`은 도메인별로 다르게 설정 — 재고처럼 자주 바뀌는 데이터는 짧게(10초), 회원 등급처럼 자주 안 바뀌는 데이터는 길게(5분).
- **클라이언트 전용 상태**(모달, 필터 선택, 옵션 선택 UI 상태): Zustand, 각 feature 폴더 내부에 스토어를 두고 전역 단일 스토어로 합치지 않습니다.
- **폼 상태**: React Hook Form이 단독으로 관리하며 Zustand와 동기화하지 않습니다.

## 4. 에러 처리

- API 에러 응답의 `error.code`(백엔드 규격)를 기준으로 사용자 메시지를 매핑합니다. 매핑 테이블은 `lib/error-messages.ts`에서 관리합니다.
- 네트워크 에러/5xx는 공통 에러 바운더리(`app/error.tsx`)가 처리하고, 재시도 버튼을 제공합니다.
- 결제 단계 에러는 별도로 `features/order/payment-error.ts`에서 세분화 처리합니다(결제는 사용자가 가장 이탈하기 쉬운 지점이라 일반 에러 UX와 다르게 취급).

## 5. 성능 원칙

- 상품 목록 이미지는 `next/image`의 `sizes`를 반드시 지정해 불필요한 큰 이미지를 다운로드하지 않도록 합니다.
- 3rd-party 스크립트(분석, 마케팅 태그)는 `next/script`의 `strategy="lazyOnload"`를 기본으로 사용합니다.
- 번들 크기 증가가 큰 라이브러리 추가는 PR에서 `next build` 결과의 First Load JS 변화를 기록합니다.
