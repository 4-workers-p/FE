# CLAUDE.md

이 저장소(commercehub-fe)에서 작업하는 AI 코딩 어시스턴트를 위한 가이드입니다.

## 저장소 성격

CommerceHub 고객용 쇼핑몰 웹입니다. 구매 전환에 직결되는 화면(상품, 장바구니, 주문/결제)이 핵심이므로 **성능(로딩 속도)과 접근성**을 다른 무엇보다 우선합니다.

## 작업 전 반드시 읽을 문서

- [`docs/architecture.md`](docs/architecture.md) — 라우팅/데이터 페칭 전략
- [`docs/coding-convention.md`](docs/coding-convention.md) — 컴포넌트 작성 규칙
- [`docs/design-collaboration.md`](docs/design-collaboration.md) — 디자이너 협업, Hubkit 사용 규칙
- [`docs/domain-glossary.md`](docs/domain-glossary.md) — 화면 문구/상태와 API 상태값 매핑

## 코드 작성 원칙

1. **Hubkit 우선**: 버튼, 인풋, 모달 등 프리미티브 UI는 `@commercehub/hubkit`에서 가져다 씁니다. Hubkit에 없는 컴포넌트가 필요하면 임의로 새로 만들지 말고 먼저 디자인시스템팀에 요청합니다(사내 정책, [`docs/design-collaboration.md`](docs/design-collaboration.md) 참고).
2. **서버 상태와 클라이언트 상태 분리**: API로 가져오는 데이터는 TanStack Query로만 관리하고 Zustand 전역 스토어에 복제하지 않습니다. Zustand는 UI 전용 상태(모달 열림 여부, 필터 선택 등)에만 사용합니다.
3. **App Router 데이터 페칭**: 상품 상세처럼 SEO가 중요한 페이지는 서버 컴포넌트에서 fetch하고, 장바구니/마이페이지처럼 개인화된 화면은 클라이언트 컴포넌트 + TanStack Query를 사용합니다.
4. **금액 표기**: 화면에 노출되는 모든 금액은 `formatKrw()` 유틸을 거칩니다(직접 `toLocaleString()`을 산발적으로 쓰지 않음). 백엔드가 내려주는 금액은 원 단위 정수이며 프론트에서 임의로 반올림/절사하지 않습니다.
5. **이미지**: `next/image` 사용을 기본으로 하고, CDN 도메인은 `next.config`에 등록된 것만 허용합니다.
6. **접근성**: 인터랙티브 요소는 키보드 포커스 가능해야 하며, 이미지에는 대체 텍스트가 필요합니다. 결제 버튼처럼 전환에 직결되는 요소는 특히 신경 씁니다.

## 화면 상태 ↔ 서버 상태 매핑 시 주의

기획/디자인에서 쓰는 화면 문구(예: "배송조회 가능")를 서버 주문 상태 Enum(`IN_TRANSIT`)에 1:1로 하드코딩하지 않습니다. 문구는 i18n 리소스(`locales/ko.json`)에서 관리하고, Enum → 문구 매핑 테이블 하나만 두어 문구가 바뀌어도 로직 코드를 건드리지 않게 합니다. 자세한 매핑은 [`docs/domain-glossary.md`](docs/domain-glossary.md)를 참고합니다.

## 테스트 기준

- 주요 사용자 흐름(상품 상세 → 장바구니 담기 → 주문/결제)은 Playwright E2E로 커버되어 있어야 합니다. 이 흐름에 영향을 주는 변경은 관련 E2E 테스트를 함께 업데이트합니다.
- 신규 공용 컴포넌트는 Storybook에 스토리를 추가합니다(디자이너 리뷰 근거 자료로 사용).

## Git / PR 규칙 (사내 정책 발췌)

- 커밋 메시지: `[영역] 요약`. 예) `[cart] 품절 SKU 담기 방지 로직 추가`
- 디자인 변경(스타일, 레이아웃, 신규 컴포넌트)이 포함된 PR은 설명에 Figma 링크와 스크린샷(Before/After)을 첨부합니다.
- `main` 직접 push 금지, PR + 리뷰 승인 후 병합. 전체 정책은 [`docs/release-checklist.md`](docs/release-checklist.md) 참고.

## 보안/개인정보

- 로그(콘솔 포함)에 사용자 개인정보, 주소, 결제수단 정보를 출력하지 않습니다.
- 클라이언트 코드/환경변수에 시크릿 키를 포함하지 않습니다. `NEXT_PUBLIC_` 접두사가 붙는 값은 브라우저에 그대로 노출된다는 점을 항상 전제합니다.
