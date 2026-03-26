#!/usr/bin/env npx tsx
// pw CLI — Playwright Skill 통합 커맨드
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join, resolve } from 'path';

const SCRIPTS_DIR = resolve(import.meta.dirname || __dirname, '.');
const args = process.argv.slice(2);
const command = args[0];
const rest = args.slice(1).join(' ');

const COMMANDS: Record<string, { script: string; desc: string }> = {
  navigate:    { script: 'navigate.ts',    desc: 'URL 이동' },
  screenshot:  { script: 'screenshot.ts',  desc: '페이지 캡처' },
  click:       { script: 'click.ts',       desc: '요소 클릭' },
  dblclick:    { script: 'dblclick.ts',    desc: '더블 클릭' },
  drag:        { script: 'drag.ts',        desc: '드래그 앤 드롭' },
  fill:        { script: 'fill.ts',        desc: '입력 필드 채우기' },
  type:        { script: 'type.ts',        desc: '키보드 타이핑' },
  select:      { script: 'select.ts',      desc: '드롭다운 선택' },
  attr:        { script: 'attr.ts',        desc: 'DOM 속성 읽기/쓰기' },
  find:        { script: 'find.ts',        desc: 'DOM 요소 탐색' },
  wait:        { script: 'wait.ts',        desc: '조건부 대기' },
  evaluate:    { script: 'evaluate.ts',    desc: 'JS 실행' },
  sequence:    { script: 'sequence.ts',    desc: '액션 시퀀스 실행' },
  console:     { script: 'console.ts',     desc: '콘솔 로그' },
  network:     { script: 'network.ts',     desc: '네트워크 요청' },
  tab:         { script: 'tab.ts',         desc: '탭 관리' },
  status:      { script: 'status.ts',      desc: '세션 상태' },
};

// 도움말
if (!command || command === 'help' || command === '--help') {
  console.log(`
pw — Playwright CLI Skill

Usage: pw <command> [args...]

Commands:
  navigate <url> [--screenshot]           URL 이동
  screenshot [selector] [--full]          페이지 캡처
  click <target> [--mode=selector|text|coord]  요소 클릭
  dblclick <target> [--mode=...]          더블 클릭
  drag <source> <target> [--mode=...]     드래그 앤 드롭
  select <selector> [--value|--label|--index]  드롭다운 선택
  attr <selector> <name> [--set=value]    DOM 속성 읽기/쓰기
  find <selector> [--detail=tag|class|full]  DOM 요소 탐색
  fill <selector> <text>                  입력 필드 채우기
  type <text> [--delay=ms]                키보드 타이핑
  wait <ms|selector> [--attr=x --value=y]  조건부 대기
  evaluate <js-expression>                JS 실행
  sequence <json|file>                    액션 시퀀스 실행
  console [inject|dump|clear|tail]        콘솔 로그
  network [inject|dump|clear|tail|find]   네트워크 요청
  tab [new|list|close] [args...]          탭 관리
  status [current|pages|all]              세션 상태
  close                                   브라우저 종료
  help                                    도움말

Global flags:
  --tab=N       특정 탭 타겟 (기본: 0)
  --headed      브라우저 표시
  --viewport=WxH  뷰포트 크기 (기본: 1920x1080)
`.trim());
  process.exit(0);
}

// close는 특수 처리
if (command === 'close') {
  const stateDir = resolve(process.cwd(), '.playwright-state');
  const portFile = join(stateDir, 'cdp-port.txt');
  try {
    if (existsSync(portFile)) {
      const { readFileSync, unlinkSync } = await import('fs');
      const port = readFileSync(portFile, 'utf-8').trim();
      execSync(`lsof -ti :${port} | xargs kill 2>/dev/null || true`, { stdio: 'ignore' });
      unlinkSync(portFile);
    }
    console.log(JSON.stringify({ success: true, data: 'Browser closed' }));
  } catch {
    console.log(JSON.stringify({ success: true, data: 'No browser to close' }));
  }
  process.exit(0);
}

// 스크립트 실행
const cmd = COMMANDS[command];
if (!cmd) {
  console.error(`Unknown command: ${command}\nRun 'pw help' for usage.`);
  process.exit(1);
}

// 로컬 우선 → 글로벌 폴백
const localScript = join(process.cwd(), 'scripts', 'playwright', cmd.script);
const globalScript = join(SCRIPTS_DIR, cmd.script);
const scriptPath = existsSync(localScript) ? localScript : globalScript;

try {
  execSync(`npx tsx "${scriptPath}" ${rest}`, {
    stdio: 'inherit',
    cwd: process.cwd(),
  });
} catch {
  // 스크립트가 자체적으로 JSON 에러를 출력하므로 여기선 무시
  process.exit(1);
}
