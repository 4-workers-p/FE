# 코딩 컨벤션 (commercehub-fe)

## 1. 컴포넌트 분류

- `components/ui`: Hubkit을 감싸는 얇은 래퍼만 위치. 비즈니스 로직 금지.
- `components/domain`: 여러 `ui` 컴포넌트를 조합한 도메인 단위 컴포넌트 (예: `ProductCard`, `OrderSummary`). 여기도 API 호출은 직접 하지 않고 props로만 데이터를 받습니다.
- `features/{도메인}`: API 클라이언트, 훅, 상태, 해당 도메인 전용 컴포넌트를 모읍니다. 다른 feature 폴더를 직접 import하지 않고 필요하면 `components/domain`을 경유합니다.

## 2. 네이밍

- 컴포넌트 파일: `PascalCase.tsx`, 훅: `useCamelCase.ts`, 유틸: `camelCase.ts`
- 이벤트 핸들러 prop: `onXxx`, 내부 핸들러 함수: `handleXxx`
- 서버 상태 훅은 `use{Domain}Query` / `use{Domain}Mutation` 형태로 통일 (예: `useProductQuery`, `useCartMutation`)

## 3. 스타일링

- Tailwind 유틸리티 클래스를 우선 사용하고, 복잡한 조합은 `cva`(class-variance-authority)로 variant를 정의합니다.
- 색상/간격 등 디자인 토큰은 Tailwind config에 등록된 Hubkit 토큰만 사용하고 임의의 hex 값을 직접 넣지 않습니다. (토큰 목록은 [`docs/design-collaboration.md`](docs/design-collaboration.md) 참고)

## 4. 타입/검증

- API 응답 타입은 `zod` 스키마로 먼저 정의하고 `z.infer`로 타입을 도출합니다. 백엔드 응답 형태가 스키마와 다르면 파싱 단계에서 에러를 던져 조기에 발견합니다.
- `any` 사용 금지. 불가피한 경우 `unknown` + 타입가드로 처리하고 사유를 주석으로 남깁니다.

## 5. 커밋 전 체크

```bash
pnpm lint
pnpm typecheck
pnpm test
```

세 명령이 모두 통과해야 PR을 올릴 수 있습니다(CI에서도 동일하게 검사).

## 6. 코드 리뷰 체크리스트 (발췌)

- [ ] Hubkit으로 대체 가능한데 새 컴포넌트를 만들지 않았는가
- [ ] 서버 상태를 Zustand에 중복 저장하지 않았는가
- [ ] 금액 표기에 `formatKrw()`를 사용했는가
- [ ] 이미지에 `alt`가 있는가, 인터랙션 요소가 키보드로 접근 가능한가
- [ ] 화면 문구를 상태 Enum에 하드코딩하지 않았는가
