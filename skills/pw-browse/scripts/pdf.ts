// ~/.claude/skills/pw-browse/scripts/pdf.ts
// Save the current page as PDF (headless chromium only).
import { run } from './common.js';
import { actionPdf } from './actions.js';
import { GLOBAL_FLAG_NAMES, isGlobalFlagArg } from './chain-utils.js';

run(async ({ rawArgs, page, session }) => {
  // Forward every non-global flag verbatim so actionPdf can reject the ones it
  // does not know. Filtering to known flags here would swallow typos silently.
  const actionArgs = rawArgs.filter(a => a.startsWith('--') && !isGlobalFlagArg(a, GLOBAL_FLAG_NAMES));

  const { result } = await actionPdf(page, actionArgs, { session });
  return { success: true, data: result };
});
