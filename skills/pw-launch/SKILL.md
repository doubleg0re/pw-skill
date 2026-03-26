---
name: pw-launch
description: Launch Playwright browser. Triggered by "open browser", "launch page", "start playwright", or auto-called when pw-browse/pw-test detects browser is not running.
---

# Playwright Browser Launch

Launch the browser and initialize the `.playwright-state/` state directory.

## Triggers

- When the user requests to launch a browser
- When `pw-browse` or `pw-test` detects the browser is not running (auto-chaining)

## Steps

### 1. Check playwright installation

```bash
npx playwright --version || npx playwright install chromium
```

### 2. Check playwright.config.ts

If `playwright.config.ts` does not exist at the project root, create it:

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

### 3. Initialize state directory

```bash
mkdir -p .playwright-state/screenshots
```

### 4. Add to .gitignore

If `.playwright-state/` is not in `.gitignore`, add it.

### 5. Verify launch

Navigate to the target URL using the navigate script to confirm:

```bash
npx tsx ~/.claude/skills/pw-browse/scripts/navigate.ts <URL> --screenshot
```

Script lookup order:
1. `{project}/scripts/playwright/navigate.ts` (local)
2. `~/.claude/skills/pw-browse/scripts/navigate.ts` (global)

### Defaults

| Option | Default | Override |
|--------|---------|----------|
| headless | `true` | Add `--headed` flag |
| browser | chromium | (chromium only for now) |
| viewport | 1920x1080 | Add `--viewport=WxH` flag |

### If headless fails

If a test fails in headless mode, retry with the `--headed` flag.

## Chaining

After this skill completes, resume the original request (pw-browse or pw-test).
