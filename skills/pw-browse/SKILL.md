---
name: pw-browse
description: Playwright 브라우저 조작. 스크린샷, 클릭, 입력, 네비게이션 등 브라우저 조작이 필요할 때 사용. "스크린샷 찍어", "버튼 클릭해", "이 페이지 가줘" 등.
---

# Playwright 브라우저 조작

범용 스크립트를 사용하여 브라우저를 조작한다.

## 트리거

- 스크린샷, 클릭, 입력, 네비게이션 등 브라우저 조작 요청
- 웹 페이지 확인이나 UI 검증이 필요한 상황

## 사전 조건

`.playwright-state/` 디렉토리가 없으면 `pw-launch` 스킬을 먼저 호출.

## 스크립트 탐색 순서

1. `{project}/scripts/playwright/{name}.ts` (로컬 — 프로젝트별 커스텀)
2. `~/.claude/skills/pw-browse/scripts/{name}.ts` (글로벌 — 기본)

로컬에 동일한 이름의 스크립트가 있으면 로컬을 우선 사용.

## 실행 방식

```bash
# 로컬 스크립트 존재 시
npx tsx scripts/playwright/{name}.ts [args...]

# 글로벌 폴백
npx tsx ~/.claude/skills/pw-browse/scripts/{name}.ts [args...]
```

## 범용 스크립트 목록

### navigate.ts — URL 이동
```bash
npx tsx {script_path}/navigate.ts <url> [--screenshot] [--headed] [--viewport=WxH]
```

### screenshot.ts — 페이지 캡처
```bash
npx tsx {script_path}/screenshot.ts [selector] [--full] [--headed]
```
- `selector`: CSS 셀렉터 (없으면 전체 페이지)
- `--full`: 전체 페이지 스크롤 캡처

### click.ts — 요소 클릭
```bash
npx tsx {script_path}/click.ts <target> [--mode=selector|text|coord]
```
- 자동 감지: `#id` `.class` → selector, `350,200` → coord, 그 외 → text
- `--mode`: 명시적 모드 지정

### dblclick.ts — 더블 클릭
```bash
npx tsx {script_path}/dblclick.ts <target> [--mode=selector|text|coord]
```
- click.ts와 동일한 인터페이스, 더블 클릭 동작

### drag.ts — 드래그 앤 드롭
```bash
npx tsx {script_path}/drag.ts <source> <target> [--mode=selector|coord]
```
- `--mode=selector`: 셀렉터 간 dragTo (기본)
- `--mode=coord`: 좌표 기반 (예: `drag.ts 100,200 300,400 --mode=coord`)

### fill.ts — 셀렉터 클릭 + 텍스트 입력
```bash
npx tsx {script_path}/fill.ts <selector> <text>
```

### type.ts — 현재 포커스에 타이핑
```bash
npx tsx {script_path}/type.ts <text> [--delay=ms]
```
- 클릭 후 이어서 사용 (click.ts → type.ts)

### evaluate.ts — JS 실행
```bash
npx tsx {script_path}/evaluate.ts <js-expression>
```

### console.ts — 콘솔 로그 수집
```bash
npx tsx {script_path}/console.ts [inject|dump|clear|tail]
```
- `inject`: 브라우저에 console 패칭 주입 (최초 1회, dump 시 자동 inject)
- `dump`: 수집된 로그를 `.playwright-state/console.log`에 append 후 브라우저 로그 비움
- `clear`: 브라우저 + 파일 로그 모두 초기화
- `tail`: 파일에서 최근 20줄 반환
- console.log/warn/error/info/debug + 페이지 에러 + unhandled rejection 전부 캡처

### network.ts — 네트워크 요청 수집
```bash
npx tsx {script_path}/network.ts [inject|dump|clear|tail|find <pattern>]
```
- `inject`: fetch/XHR 패칭 주입 (dump 시 자동 inject)
- `dump`: 수집된 요청을 `.playwright-state/network.log`에 append
- `clear`: 로그 초기화
- `tail`: 최근 20건 반환
- `find <pattern>`: URL 패턴으로 필터 (예: `find /api/projects`)
- method, url, status, request body, response body 전부 캡처

### status.ts — 세션 상태 조회
```bash
npx tsx {script_path}/status.ts [current|pages|all]
```
- `current`: 현재 프로젝트 브라우저 상태 (포트, 페이지 목록)
- `pages`: 열린 탭/페이지 목록 (title, url)
- `all`: 전체 워크스페이스에서 떠있는 브라우저 세션 조회

### tab.ts — 탭 관리
```bash
npx tsx {script_path}/tab.ts [new [url] | list | close <index>]
```
- `new [url]`: 새 탭 열기, index 반환
- `list`: 열린 탭 목록 (index, title, url)
- `close <index>`: 탭 닫기

### 모든 스크립트에서 `--tab=N` 지원
```bash
npx tsx {script_path}/click.ts "#btn" --tab=1
npx tsx {script_path}/screenshot.ts --full --tab=2
```
특정 탭을 타겟. 생략하면 첫 번째 탭(0).

## 반환 형식

모든 스크립트는 stdout에 JSON을 반환:
```json
{
  "success": true,
  "screenshot": ".playwright-state/screenshots/1711234567.png",
  "data": "..."
}
```

## 커스텀 스크립트

기존 스크립트로 불가능한 복잡한 조작은 임시 스크립트를 작성하여 실행:

```typescript
// 임시 스크립트 예시
import { run, screenshotPath } from '~/.claude/skills/pw-browse/scripts/common.js';

run(async ({ page }) => {
  // 복잡한 조작 로직
  await page.goto('http://localhost:3000');
  await page.locator('#dropdown').click();
  await page.locator('[data-value="option1"]').click();

  const path = screenshotPath();
  await page.screenshot({ path });
  return { success: true, screenshot: path };
});
```

임시 스크립트는 프로젝트의 `scripts/playwright/` 디렉토리에 작성.
작업 완료 후 불필요한 임시 스크립트는 `pw-close` 시 정리.

## 체이닝

- 브라우저 미구동 → `pw-launch` 먼저 실행
- 조작 완료 후 → 브라우저 유지 (명시적 종료 전까지)
