# Sequence Error Handling Plan

## Goal

Extend `sequence` from a simple flow runner into a safer workflow DSL with:

- `try / catch / finally`
- named reusable conditions via `def`
- `and / or` nested conditions
- `wait user-action`
- syntax validation before execution

The goal is to handle mid-flow interruptions such as auth redirects, bot challenges, not-found cases, and manual recovery steps without turning the DSL into a full programming language.

## Motivation

Current `sequence` is good at:

- ordered actions
- variable interpolation
- loops and branching
- reusable action blocks via `def/call`

But it is weak at:

- reacting to unexpected state changes in the middle of a flow
- distinguishing error categories
- handling bot challenge / auth redirect / missing element cases
- pausing for human intervention
- catching syntax mistakes before runtime

This becomes more important now that:

- persistent contexts are getting stronger
- challenge detection exists in `common.ts`
- extension hooks can affect runtime behavior

## Design Principles

- Keep the DSL compact
- Preserve backward compatibility where possible
- Reuse existing `condition` semantics
- Add validation before execution instead of making runtime logic overly defensive
- Keep `rary` as the playful layer and keep core `sequence` syntax practical

## Proposed Features

### 1. `try / catch / finally`

Add a new control action:

```json
{
  "action": "try",
  "do": [
    { "action": "click", "args": ["Sign in"] }
  ],
  "catch": [
    { "action": "log", "text": "Fallback error" }
  ],
  "catch:challenge": [
    { "action": "log", "text": "Challenge detected" }
  ],
  "catch:notfound": [
    { "action": "log", "text": "Element not found" }
  ],
  "finally": [
    { "action": "screenshot" }
  ]
}
```

Execution rules:

1. Run `do`
2. If no error, skip all `catch*`
3. If an error or detected runtime condition occurs:
   - prefer matching `catch:<type>`
   - else use `catch`
   - else bubble failure upward
4. Always run `finally`

### 2. Named conditions via `def`

Extend `def` to support reusable named conditions.

Example:

```json
{
  "action": "def",
  "name": "authFail",
  "conditions": {
    "or": [
      { "ref": "$url", "contains": "/login" },
      { "ref": "$title", "contains": "Sign in" }
    ]
  }
}
```

This allows flows like:

```json
{
  "action": "try",
  "do": [
    { "action": "click", "args": ["Open dashboard"] }
  ],
  "catch:authFail": [
    { "action": "goto", "label": "login-flow" }
  ]
}
```

Intent:

- `def + do` keeps current behavior for reusable blocks
- `def + conditions` defines named condition matchers

These two forms must be mutually exclusive.

## Condition Grammar

### 3. Extend existing `condition` action with `and / or`

Current single-condition form stays valid:

```json
{
  "action": "condition",
  "ref": "$url",
  "contains": "/login",
  "then": [...]
}
```

New nested form:

```json
{
  "action": "condition",
  "and": [
    { "ref": "$url", "contains": "/login" },
    {
      "or": [
        { "ref": "$title", "contains": "Sign in" },
        { "ref": "$title", "contains": "Login" }
      ]
    }
  ],
  "then": [...]
}
```

Leaf condition fields remain:

- `ref`
- `eq`
- `neq`
- `gt`
- `lt`
- `contains`
- `exists`

Composite condition nodes:

- `{ "and": [ ... ] }`
- `{ "or": [ ... ] }`

### 4. Single-condition shorthand remains

For simple cases, no wrapper required:

```json
{ "action": "condition", "ref": "user.role", "eq": "admin", "then": [...] }
```

Only complex conditions use `and / or`.

## Human Intervention

### 5. `wait user-action`

Add a new `wait` mode:

```json
{ "action": "wait", "args": ["user-action"] }
```

Optional prompt:

```json
{
  "action": "wait",
  "args": ["user-action"],
  "prompt": "Solve the challenge, then click Continue"
}
```

Behavior:

- headed mode only
- inject a lightweight page overlay
- top-right message:
  - title: `Waiting for user action`
  - body: optional prompt
  - button: `Continue`
- when clicked, the step completes

Headless behavior:

- fail with a clear error such as:
  - `wait user-action requires --headed`

## Runtime Error Typing

### 6. Error categories for `catch:*`

The engine should classify runtime outcomes into named categories when possible.

Initial recommended categories:

- `challenge`
- `notfound`
- `authFail`
- `timeout`
- `error`

Resolution order:

1. explicit detected condition name
2. built-in runtime classification
3. fallback `catch`

Named conditions from `def.conditions` should be checked before generic fallback.

## Syntax Validation

### 7. Add pre-execution validation

Before any step runs:

1. parse JSON
2. validate step structure
3. abort early with syntax errors if invalid

Recommended validator entrypoint:

- `validateSteps(steps): ValidationError[]`

### 8. Validation rules

#### `condition`

- cannot mix leaf fields with `and` or `or`
- cannot define both `and` and `or` at the same level
- `ref` required for leaf conditions
- leaf condition must include exactly one comparator family

#### `try`

- must contain `do` array
- `catch`, `catch:*`, and `finally` must be step arrays when present
- unknown sibling keys should fail fast unless explicitly reserved

#### `def`

- must contain `name`
- may define either:
  - `do`
  - `conditions`
- cannot define both

#### `call`

- must contain `name`

#### `each`

- must contain `ref`
- must contain `do`

#### `loop`

- must contain numeric `count`
- must contain `do`

#### General

- `action` must be known unless it is a structural marker already supported
- duplicate mutually exclusive forms should fail fast

### 9. Validation error format

Errors should be explicit and indexed.

Examples:

- `Step 3: condition cannot use both "ref" and "or"`
- `Step 7: try requires "do" to be an array`
- `Step 12: def cannot define both "do" and "conditions"`
- `Step 15: "catch:challenge" must be an array of steps`

## Scope

No scope redesign in this iteration.

Current behavior remains:

- one shared `VarStore`
- `def/call`, `each`, `loop`, and nested blocks all mutate shared state

Block-local scope is intentionally deferred to keep complexity down.

## Execution Model Changes

### `def`

Current:

- `def` stores reusable block bodies

New:

- `def` stores either:
  - reusable block body
  - reusable named condition tree

Possible internal structure:

```ts
type DefEntry =
  | { kind: 'block'; params: string[]; body: Step[] }
  | { kind: 'condition'; condition: ConditionNode };
```

### `try`

`runSteps()` will need one new structural handler:

- execute `do`
- inspect result/error/challenge
- resolve matching `catch:*`
- always run `finally`

`goto` should continue to work from inside catch/finally blocks.

## Suggested Implementation Order

1. Add condition AST evaluator
   - supports leaf / and / or
   - reuse for both `condition` and named `def.conditions`

2. Add syntax validator
   - fail before runtime

3. Extend `def`
   - support `conditions`

4. Add `try / catch / finally`
   - match `catch:<name>`
   - fallback to `catch`

5. Add `wait user-action`
   - headed-only overlay

6. Add built-in runtime category mapping
   - challenge
   - notfound
   - timeout

## Open Questions

### 1. Should `catch:*` match only thrown errors, or also detected non-error states?

Recommended:

- both
- challenge detection should be able to route into `catch:challenge`

### 2. Should named condition defs be callable outside `try`?

Recommended:

- yes, eventually
- but not required in the first pass

### 3. Should `finally` run even after `goto`?

Recommended:

- yes
- `finally` should behave like cleanup

## Example End State

```json
[
  {
    "action": "def",
    "name": "authFail",
    "conditions": {
      "or": [
        { "ref": "$url", "contains": "/login" },
        { "ref": "$title", "contains": "Sign in" }
      ]
    }
  },
  {
    "label": "main-flow"
  },
  {
    "action": "try",
    "do": [
      { "action": "click", "args": ["Open dashboard"] }
    ],
    "catch:challenge": [
      {
        "action": "wait",
        "args": ["user-action"],
        "prompt": "Solve the challenge, then click Continue"
      },
      { "action": "goto", "label": "main-flow" }
    ],
    "catch:authFail": [
      { "action": "goto", "label": "login-flow" }
    ],
    "catch": [
      { "action": "log", "text": "Unhandled failure" }
    ],
    "finally": [
      { "action": "screenshot", "args": ["--name=post-try"] }
    ]
  },
  {
    "label": "login-flow"
  },
  {
    "action": "call",
    "name": "login",
    "args": ["admin@test.com", "secret"]
  }
]
```

## Summary

This plan keeps `sequence` compact while making it far more practical for real-world browser workflows.

The main ideas are:

- add `try / catch / finally`
- support `catch:<name>` through named condition defs
- extend `condition` with nested `and / or`
- add `wait user-action`
- validate syntax before execution

This gives the DSL enough resilience for auth redirects, challenge pages, recovery flows, and manual intervention without overcomplicating the base model.
