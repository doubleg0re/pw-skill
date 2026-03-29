// ~/.claude/skills/pw-browse/scripts/tab.ts
// Tab (page) management: create, list, switch, close
import { connectBrowser, ensureStateDir, output, parseArgs, hasFlag } from './common.js';

const args = parseArgs();
const command = args.filter(a => !a.startsWith('--'))[0] || 'list';
const restArgs = args.filter(a => !a.startsWith('--')).slice(1);
const headed = hasFlag(args, 'headed');

async function main() {
  const { browser, context, session } = await connectBrowser({ headless: !headed });
  const { buildRuntime } = await import('./runtime.js');
  const { assignTabId, buildTabEvent, restoreRegistry, TAB_EVENTS } = await import('./tab-registry.js');
  const { join } = await import('path');

  // Restore tab registry from session-scoped state (not project-local)
  const { globalSessionDir } = await import('./session.js');
  const registryPath = join(globalSessionDir(session.name), 'tabs.json');
  restoreRegistry(registryPath);

  const runtime = buildRuntime({ session });

  switch (command) {
    case 'new': {
      const url = restArgs[0] || 'about:blank';
      const page = await context.newPage();
      if (url !== 'about:blank') {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      }
      const tabUrl = page.url();
      const tabTitle = await page.title();
      const pageIndex = context.pages().indexOf(page);
      const tab = assignTabId(tabUrl, tabTitle, pageIndex);
      runtime.emitEvent(TAB_EVENTS.CREATED, buildTabEvent(TAB_EVENTS.CREATED, session.name, tab));
      output({
        success: true,
        data: { tabId: tab.tabId, url: tabUrl, title: tabTitle, totalTabs: context.pages().length },
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
      const { findTabByPageIndex, findTabByUrl, buildTabEvent: buildCloseEvent, TAB_EVENTS: CLOSE_EVENTS } = await import('./tab-registry.js');
      const closedTab = findTabByPageIndex(idx) || findTabByUrl(pages[idx].url());
      await pages[idx].close();
      if (closedTab) {
        runtime.emitEvent(CLOSE_EVENTS.CLOSED, buildCloseEvent(CLOSE_EVENTS.CLOSED, session.name, closedTab));
      }
      output({ success: true, data: { closed: idx, tabId: closedTab?.tabId, remaining: context.pages().length } });
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
