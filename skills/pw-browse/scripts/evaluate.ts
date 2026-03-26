// ~/.claude/skills/pw-browse/scripts/evaluate.ts
import { run } from './common.js';
import { actionEvaluate } from './actions.js';

run(async ({ page, args }) => {
  const expression = args[0];
  if (!expression) return { success: false, error: 'Usage: evaluate.ts <js-expression>' };

  const { result } = await actionEvaluate(page, [expression]);

  return { success: true, data: result };
});
