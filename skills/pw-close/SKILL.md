---
name: pw-close
description: Playwright 브라우저 종료 및 정리. "브라우저 닫아", "playwright 종료", 또는 pw-test 완료 후 자동 호출.
---

# Playwright 브라우저 종료

브라우저 프로세스를 종료하고 임시 파일을 정리한다.

## 트리거

- 사용자가 브라우저 종료를 요청할 때
- `pw-test` 완료 후 자동 호출

## 동작

### 1. 브라우저 프로세스 종료

`.playwright-state/cdp-port.txt`에서 포트를 읽고, 해당 포트를 사용하는 프로세스만 종료:

```bash
CDP_PORT=$(cat .playwright-state/cdp-port.txt 2>/dev/null)
if [ -n "$CDP_PORT" ]; then
  lsof -ti :$CDP_PORT | xargs kill 2>/dev/null || true
fi
rm -f .playwright-state/cdp-port.txt
```

### 2. storageState 보존

`.playwright-state/state.json`은 유지 (다음 세션에서 재사용 가능).
사용자가 명시적으로 삭제를 요청하면:

```bash
rm -rf .playwright-state/
```

### 3. 임시 스크립트 정리

`scripts/playwright/` 디렉토리의 임시 스크립트(사용자가 명시적으로 생성한 것이 아닌 것) 정리.
정리 전 사용자에게 확인.

## 체이닝

이 스킬은 종료 스킬이므로 이후 체이닝 없음.
