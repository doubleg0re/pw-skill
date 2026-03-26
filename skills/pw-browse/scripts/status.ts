// ~/.claude/skills/pw-browse/scripts/status.ts
// Query browser session status
import { chromium } from 'playwright';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, resolve, basename } from 'path';
import { homedir } from 'os';

const args = process.argv.slice(2);
const command = args[0] || 'current'; // current | all | pages

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
      const stateDir = resolve(process.cwd(), '.playwright-state');
      const portFile = join(stateDir, 'cdp-port.txt');
      if (!existsSync(portFile)) {
        console.log(JSON.stringify({ success: true, data: { status: 'no browser', project: basename(process.cwd()) } }));
        return;
      }
      const port = parseInt(readFileSync(portFile, 'utf-8').trim());
      const info = await isPortAlive(port);
      if (!info) {
        console.log(JSON.stringify({ success: true, data: { status: 'dead', port, project: basename(process.cwd()) } }));
        return;
      }
      const pages = await getPages(port);
      const pageList = pages
        .filter((p: any) => p.type === 'page')
        .map((p: any) => ({ title: p.title, url: p.url }));
      console.log(JSON.stringify({
        success: true,
        data: {
          status: 'alive',
          port,
          project: basename(process.cwd()),
          browser: info.Browser,
          pages: pageList,
        },
      }));
      return;
    }

    case 'pages': {
      const stateDir = resolve(process.cwd(), '.playwright-state');
      const portFile = join(stateDir, 'cdp-port.txt');
      if (!existsSync(portFile)) {
        console.log(JSON.stringify({ success: true, data: [] }));
        return;
      }
      const port = parseInt(readFileSync(portFile, 'utf-8').trim());
      const pages = await getPages(port);
      const pageList = pages
        .filter((p: any) => p.type === 'page')
        .map((p: any, i: number) => ({ index: i, title: p.title, url: p.url, id: p.id }));
      console.log(JSON.stringify({ success: true, data: pageList }));
      return;
    }

    case 'all': {
      // Scanning all .playwright-state/cdp-port.txt under home directory is impractical,
      // so search in common workspace paths
      const home = homedir();
      const searchDirs = [
        resolve(home, 'Workspace'),
        resolve(home, 'Projects'),
        resolve(home, 'Developer'),
        resolve(home, 'Code'),
        process.cwd(),
      ];

      const sessions: any[] = [];
      const checked = new Set<string>();

      for (const dir of searchDirs) {
        if (!existsSync(dir)) continue;
        try {
          const entries = readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            // Search up to 2 levels deep
            const paths = [
              join(dir, entry.name, '.playwright-state', 'cdp-port.txt'),
              ...(() => {
                try {
                  return readdirSync(join(dir, entry.name), { withFileTypes: true })
                    .filter(e => e.isDirectory())
                    .map(e => join(dir, entry.name, e.name, '.playwright-state', 'cdp-port.txt'));
                } catch { return []; }
              })(),
            ];
            for (const portFile of paths) {
              if (checked.has(portFile) || !existsSync(portFile)) continue;
              checked.add(portFile);
              const port = parseInt(readFileSync(portFile, 'utf-8').trim());
              const info = await isPortAlive(port);
              const projectDir = resolve(portFile, '..', '..');
              sessions.push({
                project: basename(projectDir),
                path: projectDir,
                port,
                status: info ? 'alive' : 'dead',
                browser: info?.Browser || null,
              });
            }
          }
        } catch {}
      }

      console.log(JSON.stringify({ success: true, data: sessions }));
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
