---
name: pw-launch
description: Playwright 브라우저 구동. "브라우저 열어", "페이지 띄워", "playwright 시작", 또는 pw-browse/pw-test가 브라우저 미구동 감지 시 자동 호출.
---

# Playwright 브라우저 구동

브라우저를 구동하고 `.playwright-state/` 상태 디렉토리를 초기화한다.

## 트리거

- 사용자가 브라우저 구동을 요청할 때
- `pw-browse` 또는 `pw-test` 스킬이 브라우저 미구동을 감지했을 때 (자동 체이닝)

## 동작

### 1. playwright 설치 확인

```bash
npx playwright --version || npx playwright install chromium
```

### 2. playwright.config.ts 확인

프로젝트 루트에 `playwright.config.ts`가 없으면 생성:

```bash
cat > playwright.config.ts << 'PWEOF'
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
    viewport: { width: 1920, height: 1080 },
    screenshot: 'only-on-failure',
    storageState: '.playwright-state/state.json',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
});
PWEOF
```

### 3. 상태 디렉토리 초기화

```bash
mkdir -p .playwright-state/screenshots
```

### 4. .gitignore에 추가

`.playwright-state/`가 `.gitignore`에 없으면 추가.

### 5. 구동 확인

navigate 스크립트로 대상 URL에 접속하여 확인:

```bash
npx tsx ~/.claude/skills/pw-browse/scripts/navigate.ts <URL> --screenshot
```

스크립트 탐색 순서:
1. `{project}/scripts/playwright/navigate.ts` (로컬)
2. `~/.claude/skills/pw-browse/scripts/navigate.ts` (글로벌)

### 기본값

| 옵션 | 기본값 | 오버라이드 |
|------|--------|-----------|
| headless | `true` | `--headed` 플래그 추가 |
| browser | chromium | (현재 chromium 고정) |
| viewport | 1920x1080 | `--viewport=WxH` 플래그 추가 |

### headless 실패 시

headless 모드에서 테스트 실패하면 `--headed` 플래그를 추가하여 재시도.

## 체이닝

이 스킬 완료 후 원래 요청한 작업(pw-browse 또는 pw-test)을 이어서 실행.
