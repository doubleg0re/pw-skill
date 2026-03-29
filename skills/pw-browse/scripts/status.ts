// status.ts — Session status via global session store
import {
  listSessions,
  isProcessAlive,
  getBoundSession,
  getSession,
  resolveSession,
} from './session.js';
import { basename } from 'path';

const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const command = args[0] || 'current';

async function isPortAlive(port: number): Promise<any> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`);
    return await res.json();
  } catch {
    return null;
  }
}

async function getPages(port: number): Promise<any[]> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json`);
    return await res.json();
  } catch {
    return [];
  }
}

async function main() {
  switch (command) {
    case 'current': {
      // Use session resolution: --session flag → binding → auto-select
      const sessionFlag = process.argv.find(a => a.startsWith('--session='))?.slice('--session='.length);
      let session;
      try {
        session = resolveSession(sessionFlag);
      } catch (err) {
        console.log(JSON.stringify({
          success: true,
          data: { status: 'no session', project: basename(process.cwd()), error: (err as Error).message },
        }));
        return;
      }

      const port = session.cdpEndpoint
        ? parseInt(session.cdpEndpoint.match(/:(\d+)\//)?.[1] || '0')
        : session.port;

      const alive = isProcessAlive(session.pid);
      if (!alive) {
        console.log(JSON.stringify({
          success: true,
          data: { status: 'dead', session: session.name, pid: session.pid, port },
        }));
        return;
      }

      const info = await isPortAlive(port);
      const pages = info ? await getPages(port) : [];
      const pageList = pages
        .filter((p: any) => p.type === 'page')
        .map((p: any) => ({ title: p.title, url: p.url }));

      console.log(JSON.stringify({
        success: true,
        data: {
          status: 'alive',
          session: session.name,
          pid: session.pid,
          port,
          cdpEndpoint: session.cdpEndpoint || null,
          lastUrl: session.lastUrl || null,
          project: basename(process.cwd()),
          bound: getBoundSession() === session.name,
          browser: info?.Browser || null,
          pages: pageList,
        },
      }));
      return;
    }

    case 'pages': {
      const sessionFlag = process.argv.find(a => a.startsWith('--session='))?.slice('--session='.length);
      let session;
      try {
        session = resolveSession(sessionFlag);
      } catch {
        console.log(JSON.stringify({ success: true, data: [] }));
        return;
      }

      const port = session.cdpEndpoint
        ? parseInt(session.cdpEndpoint.match(/:(\d+)\//)?.[1] || '0')
        : session.port;

      const pages = await getPages(port);
      const pageList = pages
        .filter((p: any) => p.type === 'page')
        .map((p: any, i: number) => ({ index: i, title: p.title, url: p.url, id: p.id }));

      console.log(JSON.stringify({ success: true, data: pageList }));
      return;
    }

    case 'all': {
      const sessions = listSessions();
      const results = [];

      for (const s of sessions) {
        const alive = isProcessAlive(s.pid);
        const port = s.cdpEndpoint
          ? parseInt(s.cdpEndpoint.match(/:(\d+)\//)?.[1] || '0')
          : s.port;

        let browser = null;
        let pageCount = 0;
        if (alive) {
          const info = await isPortAlive(port);
          browser = info?.Browser || null;
          const pages = info ? await getPages(port) : [];
          pageCount = pages.filter((p: any) => p.type === 'page').length;
        }

        results.push({
          name: s.name,
          pid: s.pid,
          port,
          status: alive ? 'alive' : 'dead',
          bound: getBoundSession() === s.name,
          browser,
          pages: pageCount,
          lastUrl: s.lastUrl || null,
        });
      }

      console.log(JSON.stringify({ success: true, data: results }));
      return;
    }

    default:
      console.log(JSON.stringify({ success: false, error: 'Usage: status.ts [current|pages|all]' }));
  }
}

main().catch(err => {
  console.log(JSON.stringify({ success: false, error: err.message }));
  process.exit(1);
});
