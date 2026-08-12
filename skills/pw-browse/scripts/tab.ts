// ~/.claude/skills/pw-browse/scripts/tab.ts
// Tab (page) management: create, list, switch, close
import { connectBrowser, ensureStateDir, output, parseArgs, parseFlag, hasFlag, pageTargetId, pageTargetIds } from './common.js';

const args = parseArgs();
const command = args.filter(a => !a.startsWith('--'))[0] || 'list';
const restArgs = args.filter(a => !a.startsWith('--')).slice(1);
const headed = hasFlag(args, 'headed');
// tab used to drop --session and answer about whichever browser was running,
// which is how a stale session name listed another project's tabs.
const sessionName = parseFlag(args, 'session');

async function main() {
  const { browser, context, session } = await connectBrowser({ headless: !headed, sessionName });
  const { buildRuntime } = await import('./runtime.js');
  const { assignTabId, buildTabEvent, restoreRegistry, updateTab, TAB_EVENTS } = await import('./tab-registry.js');
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
      const targetId = await pageTargetId(context, page);
      const tab = assignTabId(tabUrl, tabTitle, pageIndex, targetId);
      runtime.emitEvent(TAB_EVENTS.CREATED, buildTabEvent(TAB_EVENTS.CREATED, session.name, tab));
      // No index here on purpose. The position this process sees is not the one
      // the next `pw` process enumerates — a new tab shows up at the front on a
      // fresh CDP connection — so an index returned from `tab new` points at a
      // different page by the time the caller uses it. tabId does not move.
      output({
        success: true,
        data: {
          tabId: tab.tabId,
          session: session.name,
          url: tabUrl,
          title: tabTitle,
          totalTabs: context.pages().length,
        },
      });
      break;
    }

    case 'list': {
      const pages = context.pages();
      const targetIds = await pageTargetIds(context);
      const { findTabByTargetId } = await import('./tab-registry.js');
      const tabs = await Promise.all(
        pages.map(async (p, i) => {
          const targetId = targetIds[i];
          const url = p.url();
          const title = await p.title();
          // Adopt tabs pw did not open so every listed tab has an id a caller
          // can hold; an index alone reshuffles under them.
          let entry = targetId ? findTabByTargetId(targetId) : undefined;
          if (!entry && targetId) entry = assignTabId(url, title, i, targetId);
          if (entry) updateTab(entry.tabId, { url, title, pageIndex: i });
          return { index: i, tabId: entry?.tabId, url, title };
        })
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
      const { resolveTab, buildTabEvent: buildCloseEvent, TAB_EVENTS: CLOSE_EVENTS } = await import('./tab-registry.js');
      const closedTab = resolveTab(pages[idx].url(), idx);
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
