---
name: pw-test
description: Playwright E2E 테스트 작성 및 실행. "테스트 작성해", "이 페이지 테스트", "E2E 돌려" 등. 테스트 방향 확인 → 작성 → 실행 → 리포트.
---

# Playwright E2E 테스트

테스트 방향을 사용자에게 확인한 후, 테스트 코드를 작성하고 실행하여 결과를 리포트한다.

## 트리거

- E2E 테스트 작성/실행 요청
- 웹 페이지 기능 검증 요청
- "테스트 진행해줘" 같은 포괄적 테스트 요청

## 사전 조건

1. `.playwright-state/` 디렉토리가 없으면 `pw-launch` 스킬을 먼저 호출
2. `playwright.config.ts`가 없으면 `pw-launch`가 자동 생성

## 워크플로

### 1. 테스트 방향 확인

사용자에게 질문:
- 무엇을 테스트할 것인지 (페이지, 플로우, 기능)
- 어디까지 테스트할 것인지 (스모크, 기능, 전체 플로우)
- 특별히 확인해야 할 엣지 케이스가 있는지

### 2. 테스트 코드 작성

`tests/e2e/` 디렉토리에 `.spec.ts` 파일을 작성:

```typescript
import { test, expect } from '@playwright/test';

test.describe('기능명', () => {
  test('시나리오 설명', async ({ page }) => {
    await page.goto('/target-page');
    // 테스트 로직
    await expect(page.locator('selector')).toBeVisible();
  });
});
```

### 3. 테스트 실행

```bash
npx playwright test tests/e2e/{파일명}.spec.ts
```

### 4. 결과 분석 및 리포트

- 통과: 통과한 테스트 수와 소요 시간 보고
- 실패: 실패 원인 분석 + 스크린샷 확인 + 수정 제안
- 실패 시 `--headed` 모드로 재시도 제안

### 5. headless 실패 시 재시도

```bash
npx playwright test tests/e2e/{파일명}.spec.ts --headed
```

## 체이닝

- 브라우저 미구동 → `pw-launch` 먼저 실행
- 테스트 완료 → `pw-close` 자동 호출
