// ~/.claude/skills/pw-browse/scripts/network.ts
// Inject fetch/XHR patching into the browser and dump collected network logs to a file
import { run, hasFlag, parseFlag } from './common.js';
import { runNetworkCommand } from './network-runtime.js';

run(async ({ page, args }) => {
  const cliArgs = process.argv.slice(2);
  const bodyLimitRaw = parseFlag(cliArgs, 'body-limit');
  const bodyLimit = bodyLimitRaw ? (parseInt(bodyLimitRaw, 10) || 5000) : undefined;

  return runNetworkCommand(page, {
    command: args[0],
    pattern: args[1],
    raw: hasFlag(cliArgs, 'raw'),
    redactionLevel: parseFlag(cliArgs, 'redaction-level'),
    body: hasFlag(cliArgs, 'body'),
    json: hasFlag(cliArgs, 'json'),
    bodyLimit,
  });
});
