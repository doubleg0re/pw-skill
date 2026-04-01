// ~/.claude/skills/pw-browse/scripts/console.ts
// Inject console patching into the browser and dump collected logs to a file
import { run, hasFlag, parseFlag } from './common.js';
import { filterLines, runConsoleCommand } from './console-runtime.js';

export { filterLines };

run(async ({ page, args }) => {
  const cliArgs = process.argv.slice(2);
  return runConsoleCommand(page, {
    command: args[0],
    filters: args.slice(1),
    raw: hasFlag(cliArgs, 'raw'),
    redactionLevel: parseFlag(cliArgs, 'redaction-level'),
  });
});
