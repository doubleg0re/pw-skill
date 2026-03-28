# Sequence Shell and Human Interaction Plan

## Goal

Add two related capabilities to `pw sequence`:

- controlled local command execution via `shell`
- structured human confirmation/input via `wait user-action`

These features should work together so flows can safely pause, ask for approval, and continue based on the selected response.

## Motivation

Some workflows need more than browser actions.

Examples:

- start or inspect a local server
- run helper commands
- trigger setup scripts
- ask the user for approval before a risky step
- pause for a manual challenge solve, then continue

The sequence engine already has the right shape for this, but it needs:

- a safe shell execution gate
- a richer `user-action` primitive than a single Continue button

## Design Principles

- shell execution must be explicitly enabled
- user interaction must be structured, not ad-hoc
- dangerous steps should be visible to the user
- browser flows and human-in-the-loop flows should reuse the same DSL
- keep the syntax small

## 1. Shell Action

### Syntax

```json
{
  "action": "shell",
  "args": ["npm", "run", "dev"],
  "out": "devServer"
}
```

Alternative object form:

```json
{
  "action": "shell",
  "args": {
    "command": ["npm", "run", "dev"],
    "timeout": 10000
  },
  "out": "devServer"
}
```

### Result shape

Recommended result object:

```json
{
  "exitCode": 0,
  "stdout": "...",
  "stderr": "..."
}
```

## 2. Shell Safety Gates

Shell must never run silently by default.

### `--allow-shell`

Sequence execution must reject any `shell` action unless the CLI includes:

```bash
pw sequence flow.json --allow-shell
```

Without it:

- fail before shell execution
- return a clear error

Recommended message:

- `Sequence contains shell action. Re-run with --allow-shell to enable local command execution.`

### `--request-permission`

Optional runtime approval mode:

```bash
pw sequence flow.json --allow-shell --request-permission
```

Meaning:

- shell is allowed
- but each shell step requires user confirmation before running

This should integrate with `wait user-action`.

## 3. `wait user-action`

### Basic form

```json
{
  "action": "wait",
  "args": ["user-action"]
}
```

### Prompt form

```json
{
  "action": "wait",
  "args": ["user-action"],
  "prompt": "Solve the challenge, then click Continue"
}
```

### Multi-action form

```json
{
  "action": "wait",
  "args": ["user-action"],
  "prompt": "Shell action wants to run. Approve?",
  "actions": ["approve", "cancel"],
  "out": "permission"
}
```

### Behavior

- headed mode only
- inject a floating overlay into the page
- render:
  - title
  - optional prompt
  - one or more action buttons
- when a button is clicked:
  - remove overlay
  - return selected action
  - store selected action in `out` if provided

## 4. `wait user-action` Output

If `actions` is provided, the clicked button value becomes the result.

Example:

```json
{
  "action": "wait",
  "args": ["user-action"],
  "prompt": "Continue with shell?",
  "actions": ["approve", "cancel"],
  "out": "permission"
}
```

Result:

- `permission = "approve"` or `"cancel"`

Recommended default:

- if `actions` is omitted, use `["continue"]`

## 5. Headed vs Headless

### Headed

Allowed.

### Headless

`wait user-action` must fail clearly.

Recommended error:

- `wait user-action requires --headed`

Shell permission requests also depend on visible user interaction, so:

- `--request-permission` should require headed mode
- otherwise fail early

## 6. Shell + Human Approval Flow

Example:

```json
[
  {
    "action": "wait",
    "args": ["user-action"],
    "prompt": "Shell action wants to run. Approve?",
    "actions": ["approve", "cancel"],
    "out": "permission"
  },
  {
    "action": "condition",
    "ref": "permission",
    "eq": "approve",
    "then": [
      { "action": "shell", "args": ["npm", "run", "build"] }
    ],
    "else": [
      { "action": "log", "text": "Shell execution canceled" }
    ]
  }
]
```

This gives a clean confirm-style interaction without needing a separate `confirm` action.

## 7. Shell with `--request-permission`

If `--request-permission` is active, shell actions may automatically wrap themselves in a confirmation prompt.

Conceptually:

1. engine sees shell step
2. engine shows `wait user-action`
3. if approved, run shell
4. if canceled, fail or skip depending on policy

Possible prompt text:

- `Sequence wants to run a local command. Approve?`
- `This step may modify local files or processes. Continue?`

Possible default actions:

- `["approve", "cancel"]`

## 8. Cancellation Policy

Open question: if user clicks `cancel`, what should happen?

Recommended initial behavior:

- treat as a normal sequence failure with a clear message

Possible future option:

- `onCancel: "fail" | "skip"`

But not required for the first pass.

## 9. Validation Rules

### `shell`

- requires `--allow-shell` at runtime
- `args` must be array or valid object form

### `wait user-action`

- `prompt` must be string if present
- `actions` must be string array if present
- `actions` must not be empty
- `out` must not start with `$`

### `--request-permission`

- if used, require headed mode

## 10. Recommended Warnings

When shell is present:

- include warning in sequence result
- mention that local commands may modify files or processes

Example warning:

- `Warning: shell action enabled. Only run trusted sequences.`

If permission mode is active:

- `Warning: shell action requires user approval.`

## 11. Suggested Implementation Order

1. Add `shell` action
2. Add `--allow-shell`
3. Reject shell without opt-in
4. Extend `wait user-action` with:
   - `prompt`
   - `actions`
   - `out`
5. Add `--request-permission`
6. Route shell approval through `wait user-action`
7. Add validator rules
8. Add result warnings

## 12. Example End State

```json
[
  {
    "action": "wait",
    "args": ["user-action"],
    "prompt": "A local shell command is about to run.",
    "actions": ["approve", "cancel"],
    "out": "permission"
  },
  {
    "action": "condition",
    "ref": "permission",
    "eq": "approve",
    "then": [
      {
        "action": "shell",
        "args": ["npm", "run", "dev"],
        "out": "shellResult"
      }
    ],
    "else": [
      { "action": "log", "text": "User canceled shell execution." }
    ]
  }
]
```

## Summary

This plan adds a safe bridge between browser automation, local command execution, and human approval.

Key pieces:

- `shell` action
- `--allow-shell`
- optional `--request-permission`
- richer `wait user-action`
- `prompt + actions + out`

This keeps shell execution explicit and makes human confirmation a first-class part of the sequence DSL.
