---
name: pw-test
description: Write and run Playwright E2E tests. Triggered by "write a test", "test this page", "run E2E", etc. Flow: confirm test direction → write → run → report.
---

# Playwright E2E Tests

Confirm the test direction with the user, then write the test code, run it, and report the results.

## Triggers

- Requests to write or run E2E tests
- Requests to validate web page functionality
- Broad test requests like "run the tests for me"

## Prerequisites

1. If the `.playwright-state/` directory does not exist, invoke the `pw-launch` skill first
2. If `playwright.config.ts` does not exist, `pw-launch` will create it automatically

## Workflow

### 1. Confirm test direction

Ask the user:
- What to test (page, flow, feature)
- How far to test (smoke, functional, full flow)
- Any edge cases that need special attention

### 2. Write test code

Write a `.spec.ts` file in the `tests/e2e/` directory:

```typescript
import { test, expect } from '@playwright/test';

test.describe('Feature name', () => {
  test('scenario description', async ({ page }) => {
    await page.goto('/target-page');
    // test logic
    await expect(page.locator('selector')).toBeVisible();
  });
});
```

### 3. Run the test

```bash
npx playwright test tests/e2e/{filename}.spec.ts
```

### 4. Analyze results and report

- Pass: Report number of passing tests and elapsed time
- Fail: Analyze failure cause + review screenshot + suggest fix
- On failure: Suggest retrying with `--headed` mode

### 5. Retry on headless failure

```bash
npx playwright test tests/e2e/{filename}.spec.ts --headed
```

## Chaining

- Browser not running → run `pw-launch` first
- Tests complete → auto-call `pw-close`
