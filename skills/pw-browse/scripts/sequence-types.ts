// sequence-types.ts — shared types for the sequence flow engine.
//
// These live in their own module so that sequence.ts, sequence-validate.ts,
// and sequence-params.ts can all import the same shapes without circular
// dependencies on the engine itself.
//
// This file is part of the Phase 1 refactor of sequence.ts — see
// .claude/docs/sequence-refactor.md. Runtime behavior is intentionally
// unchanged.

// --- Condition AST ---

export interface LeafCondition {
  ref: string;
  eq?: any;
  neq?: any;
  gt?: number;
  lt?: number;
  contains?: string;
  exists?: boolean;
}

export interface CompositeCondition {
  and?: ConditionNode[];
  or?: ConditionNode[];
}

export type ConditionNode = LeafCondition | CompositeCondition;

// --- Step ---

export interface Step {
  action?: string;
  args?: string[] | Record<string, any>;
  out?: string;
  // comment (no-op documentation)
  comment?: string;
  // label / goto
  label?: string;
  // def / call
  type?: 'func' | 'condition' | 'flow';
  name?: string;
  params?: string[];
  items?: Step[] | ConditionNode[];
  path?: string;
  // return
  value?: any;
  // log
  text?: string;
  // condition (leaf — backward compat)
  ref?: string;
  eq?: any;
  neq?: any;
  gt?: number;
  lt?: number;
  contains?: string;
  exists?: boolean;
  // condition (composite)
  and?: ConditionNode[];
  or?: ConditionNode[];
  then?: Step[];
  else?: Step[];
  // each
  as?: string;
  // loop
  count?: number; // backward compat — prefer condition
  condition?: ConditionNode;
  // try/catch/finally
  catch?: Step[];
  finally?: Step[];
  [key: `catch:${string}`]: Step[] | undefined;
  // wait user-action
  prompt?: string;
  actions?: string[];
}

// --- Subflow / def entries ---

export interface SubflowInfo {
  type: 'subflow';
  parameters?: string[];
  returns?: string;
}

export type DefEntry =
  | { kind: 'block'; params: string[]; body: Step[] }
  | { kind: 'condition'; condition: ConditionNode }
  | { kind: 'flow'; params: string[]; path: string; steps: Step[]; info: SubflowInfo };

// --- Step result ---

export interface StepResult {
  step: number;
  action: string;
  success: boolean;
  data?: any;
  error?: string;
}
