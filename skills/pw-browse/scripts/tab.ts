// ~/.claude/skills/pw-browse/scripts/tab.ts
// 탭(페이지) 관리: 생성, 목록, 전환, 닫기
import { connectBrowser, ensureStateDir, output, parseArgs, hasFlag } from './common.js';

const args = parseArgs();
const command = args.filter(a => !a.startsWith('--'))[0] || 'list';
const restArgs = args.filter(a => !a.startsWith('--')).slice(1);
const headed = hasFlag(args, 'headed');

async function main() {
  const { browser, context } = await connectBrowser({ headless: !headed });

  switch (command) {
    case 'new': {
      const url = restArgs[0] || 'about:blank';
      const page = await context.newPage();
      if (url !== 'about:blank') {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      }
      const pages = context.pages();
      const index = pages.indexOf(page);
      output({
        success: true,
        data: {
          index,
          url: page.url(),
          title: await page.title(),
          totalTabs: pages.length,
        },
      });
      break;
    }

    case 'list': {
      const pages = context.pages();
      const tabs = await Promise.all(
        pages.map(async (p, i) => ({
          index: i,
          url: p.url(),
          title: await p.title(),
        }))
      );
      output({ success: true, data: tabs });
      break;
    }

    case 'close': {
      const target = restArgs[0];
      if (!target) {
        output({ success: false, error: 'Usage: tab.ts close <index>' });
        break;
      }
      const pages = context.pages();
      const idx = parseInt(target);
      if (isNaN(idx) || idx < 0 || idx >= pages.length) {
        output({ success: false, error: `Invalid index. ${pages.length} tabs open (0-${pages.length - 1})` });
        break;
      }
      await pages[idx].close();
      output({ success: true, data: { closed: idx, remaining: context.pages().length } });
      break;
    }

    default:
      output({ success: false, error: 'Usage: tab.ts [new [url] | list | close <index>]' });
  }

  process.exit(0);
}

main().catch(err => {
  output({ success: false, error: err.message });
  process.exit(1);
});
