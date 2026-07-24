// sequence-validate.ts — syntax and pre-run validators for the sequence
// flow engine.
//
// Extracted from sequence.ts as part of the Phase 1 refactor
// (.claude/docs/sequence-refactor.md). Behavior is intentionally unchanged;
// this file only contains pure helpers.

import type { Step } from './sequence-types.js';

// --- Known action set ---
//
// Built-in action names recognized by the validator. Extensions can add more
// at validation time via `extraKnownActions`. Keep this list in sync with
// actions.ts / the CLI dispatch table.
export const KNOWN_ACTIONS = new Set([
  'navigate', 'nav', 'refresh', 'reload', 'resize', 'click', 'dblclick', 'drag', 'fill', 'type', 'press', 'wait', 'hover',
  'scroll', 'select', 'sel', 'upload', 'attr', 'submit', 'fetch', 'screenshot', 'shot',
  'evaluate', 'eval', 'log', 'condition', 'each', 'loop', 'def', 'call', 'goto', 'try', 'shell', 'set', 'dump', 'console', 'network', 'dialog', 'return', 'assert',
]);

/**
 * Validate a steps array against the sequence DSL rules. Returns a list of
 * human-readable error messages (empty array means valid).
 *
 * `extraKnownActions` is how rary extensions register custom action names so
 * they aren't reported as "unknown action" during validation.
 */
export function validateSteps(steps: Step[], prefix: string = '', extraKnownActions?: Set<string>): string[] {
  const allKnown = extraKnownActions
    ? new Set([...KNOWN_ACTIONS, ...extraKnownActions])
    : KNOWN_ACTIONS;
  const errors: string[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const loc = `${prefix}Step ${i}`;

    // Label-only or comment-only step
    if (!step.action && step.label) continue;
    if (!step.action && step.comment) {
      // comment-only step — valid no-op
      continue;
    }
    if (!step.action && !step.label && !step.comment) {
      errors.push(`${loc}: step has no action, label, or comment`);
      continue;
    }

    const action = step.action!;

    // comment + action is invalid
    if (step.comment && step.action) {
      errors.push(`${loc}: step cannot have both "comment" and "action"`);
    }

    // Unknown action
    if (!allKnown.has(action)) {
      errors.push(`${loc}: unknown action "${action}"`);
    }

    // condition
    if (action === 'condition') {
      const hasLeaf = 'ref' in step;
      const hasComposite = 'and' in step || 'or' in step;
      if (hasLeaf && hasComposite) {
        errors.push(`${loc}: condition cannot mix "ref" with "and"/"or"`);
      }
      if ('and' in step && 'or' in step) {
        errors.push(`${loc}: condition cannot have both "and" and "or" at same level`);
      }
      if (hasLeaf && !step.ref) {
        errors.push(`${loc}: condition leaf requires "ref"`);
      }
    }

    // def
    if (action === 'def') {
      if (!step.name) errors.push(`${loc}: def requires "name"`);
      if (step.type && !['func', 'condition', 'flow'].includes(step.type)) {
        errors.push(`${loc}: def type must be "func", "condition", or "flow"`);
      }
      if (step.type === 'flow') {
        if (!step.path) errors.push(`${loc}: def type="flow" requires "path"`);
        if (step.items) errors.push(`${loc}: def type="flow" cannot have "items" (use "path")`);
      }
    }

    // return
    if (action === 'return') {
      if (!step.value) errors.push(`${loc}: return requires "value"`);
    }

    // call
    if (action === 'call') {
      if (!step.name) errors.push(`${loc}: call requires "name"`);
    }

    // each
    if (action === 'each') {
      if (!step.ref) errors.push(`${loc}: each requires "ref"`);
      if (!step.items) errors.push(`${loc}: each requires "items"`);
    }

    // loop
    if (action === 'loop') {
      if (step.count === undefined && !step.condition) {
        errors.push(`${loc}: loop requires "condition" or "count"`);
      }
      if (!step.items) errors.push(`${loc}: loop requires "items"`);
    }

    // try
    if (action === 'try') {
      const tryBody = step.items;
      if (!tryBody || !Array.isArray(tryBody)) {
        errors.push(`${loc}: try requires "items" array`);
      }
      if (step.finally && !Array.isArray(step.finally)) {
        errors.push(`${loc}: try "finally" must be an array`);
      }
    }

    // set
    if (action === 'set') {
      if (!step.items || typeof step.items !== 'object' || Array.isArray(step.items)) {
        errors.push(`${loc}: set requires "items" as object`);
      } else {
        for (const [name, source] of Object.entries(step.items as Record<string, any>)) {
          if (name.startsWith('$')) {
            errors.push(`${loc}: set destination "${name}" cannot start with "$"`);
          }
          if (source && 'ref' in source && 'value' in source) {
            errors.push(`${loc}: set item "${name}" must contain exactly one of "ref" or "value"`);
          }
          if (source && !('ref' in source) && !('value' in source)) {
            errors.push(`${loc}: set item "${name}" must contain "ref" or "value"`);
          }
        }
      }
    }

    // shell
    if (action === 'shell') {
      if (!step.args) errors.push(`${loc}: shell requires "args"`);
    }

    // wait
    if (action === 'wait') {
      if (step.actions) {
        if (!Array.isArray(step.actions) || step.actions.length === 0) {
          errors.push(`${loc}: wait "actions" must be a non-empty string array`);
        }
      }
      // observation wait requires trigger
      const tgt = (step.args as any)?.[0] || (step as any).target;
      if (typeof tgt === 'string' && (tgt.startsWith('dom:') || tgt.startsWith('url:') || tgt === 'challenge')) {
        // trigger recommended but not strictly required (could just wait for change)
      }
    }

    // goto
    if (action === 'goto') {
      if (!step.label) errors.push(`${loc}: goto requires "label"`);
    }

    // out cannot use $ prefix (reserved for built-in variables)
    if (step.out && step.out.startsWith('$')) {
      errors.push(`${loc}: "out" cannot start with "$" (reserved for built-in variables like $index, $error)`);
    }

    // Recurse into nested steps (skip condition def items — they're ConditionNode[], not Step[])
    if (step.items && !(step.action === 'def' && step.type === 'condition')) {
      errors.push(...validateSteps(step.items as Step[], `${loc}.items → `, extraKnownActions));
    }
    if (step.then) errors.push(...validateSteps(step.then, `${loc}.then → `, extraKnownActions));
    if (step.else) errors.push(...validateSteps(step.else, `${loc}.else → `, extraKnownActions));
    if (step.finally) errors.push(...validateSteps(step.finally as Step[], `${loc}.finally → `, extraKnownActions));
  }

  return errors;
}

/**
 * Validate the `info.requiresRary` field plus any CLI `--rary=` overrides
 * against the set of currently active extensions. Returns an error string
 * describing what is missing, or `null` if everything is satisfied.
 *
 * `installedExtensions` lets us give a clearer hint for packages that are
 * installed but not activated ("run `pw rary put <name>`").
 */
export function validateRequiresRary(
  info: any,
  cliRary: string[],
  activeExtensions: Set<string>,
  installedExtensions?: Set<string>,
): string | null {
  // Format validation
  if (info?.requiresRary !== undefined) {
    if (!Array.isArray(info.requiresRary) || !info.requiresRary.every((r: any) => typeof r === 'string' && r.length > 0)) {
      return 'info.requiresRary must be an array of non-empty strings.';
    }
  }

  const required: string[] = [
    ...(Array.isArray(info?.requiresRary) ? info.requiresRary : []),
    ...cliRary,
  ];

  if (required.length === 0) return null;

  const missing = required.filter(name => !activeExtensions.has(name));
  if (missing.length === 0) return null;

  // Distinguish installed-but-inactive from not-installed
  const details = missing.map(name => {
    if (installedExtensions?.has(name)) {
      return `"${name}" (installed but not active — run \`pw rary put ${name}\`)`;
    }
    return `"${name}" (not installed — run \`pw rary get <repo> && pw rary put ${name}\`)`;
  });

  return `Flow requires rary extension(s): ${details.join(', ')}`;
}

export function validateFlowParameters(
  info: any,
  paramsData: Record<string, any>,
): string | null {
  if (info?.parameters === undefined) {
    return null;
  }

  if (!Array.isArray(info.parameters) || !info.parameters.every((param: any) => typeof param === 'string' && param.length > 0)) {
    return 'info.parameters must be an array of non-empty strings.';
  }

  const declared = info.parameters as string[];
  const providedKeys = Object.keys(paramsData);
  const missing = declared.filter((name) => !(name in paramsData));
  const unknown = providedKeys.filter((name) => !declared.includes(name));

  if (missing.length === 0 && unknown.length === 0) {
    return null;
  }

  const issues: string[] = [];
  if (missing.length > 0) {
    issues.push(`missing required params: ${missing.join(', ')}`);
  }
  if (unknown.length > 0) {
    issues.push(`unknown params: ${unknown.join(', ')}`);
  }

  return `Flow parameter contract mismatch (${issues.join('; ')}).`;
}
