# Sequence Syntax

Minimal syntax reference for AI-generated `pw sequence` flows.

## Root

Sequence input must be a JSON array of steps.

```json
[
  { "action": "navigate", "args": ["https://example.com"] }
]
```

## Step Shape

```json
{
  "action": "string",
  "args": [],
  "out": "varName"
}
```

Common fields:

- `action`
- `args`
- `out`
- `label`
- `name`
- `params`
- `ref`
- `text`
- `type`
- `items`
- `then`
- `else`
- `catch`
- `catch:<name>`
- `finally`
- `condition`
- `actions`
- `prompt`

## Variables

### Store action result

```json
{ "action": "fetch", "args": ["GET", "/api/me"], "out": "me" }
```

### Read variable

```json
{ "action": "log", "text": "{{me.name}}" }
```

### Special variables

- `{{$index}}`
- `{{$key}}`
- `{{$error}}`
- `{{$errorType}}`

## Basic Actions

```json
{ "action": "navigate", "args": ["https://example.com"] }
{ "action": "click", "args": ["Sign in"] }
{ "action": "fill", "args": ["#email", "{{email}}"] }
{ "action": "wait", "args": ["1000"] }
{ "action": "wait", "args": ["user-action"], "prompt": "Solve the challenge, then click Continue" }
{ "action": "log", "text": "done" }
{ "action": "goto", "label": "start" }
```

## Label / Goto

```json
[
  { "label": "start" },
  { "action": "click", "args": [".retry"] },
  { "action": "goto", "label": "start" }
]
```

## shell

Execute a local command. Requires `--allow-shell` flag. With `--request-permission`, prompts the user for approval before each execution (requires `--headed`).

```bash
pw sequence flow.json --allow-shell
pw sequence flow.json --allow-shell --request-permission --headed
```

```json
{ "action": "shell", "args": ["node", "scripts/seed.js"], "out": "seed" }
```

Result stored in `out`:

```json
{ "exitCode": 0, "stdout": "...", "stderr": "" }
```

Object args format:

```json
{ "action": "shell", "args": { "command": ["npm", "run", "build"], "timeout": 60000 } }
```

## wait user-action

Pause execution and show an overlay with action buttons. The clicked button value is stored in `out`.

```json
{
  "action": "wait",
  "args": ["user-action"],
  "prompt": "Choose an action",
  "actions": ["approve", "skip", "cancel"],
  "out": "choice"
}
```

- `actions`: Array of button labels (default: `["continue"]` when omitted)
- `out`: Stores the clicked button value

## def / call

### Function definition

```json
{
  "action": "def",
  "name": "login",
  "type": "func",
  "params": ["email", "pass"],
  "items": [
    { "action": "fill", "args": ["#email", "{{email}}"] },
    { "action": "fill", "args": ["#password", "{{pass}}"] },
    { "action": "click", "args": ["Sign in"] }
  ]
}
```

`type` defaults to `"func"` when omitted.

### Block call

```json
{ "action": "call", "name": "login", "args": ["admin@test.com", "secret"] }
```

```json
{ "action": "call", "name": "login", "args": { "email": "admin@test.com", "pass": "secret" } }
```

### Condition definition

```json
{
  "action": "def",
  "name": "authFail",
  "type": "condition",
  "items": [
    { "ref": "$url", "contains": "/login" },
    { "ref": "$title", "contains": "Sign in" }
  ]
}
```

When `type` is `"condition"`, `items` is an array of `ConditionNode`. Multiple items are combined with `or`.

## condition

### Single condition

```json
{
  "action": "condition",
  "ref": "user.role",
  "eq": "admin",
  "then": [
    { "action": "navigate", "args": ["/admin"] }
  ],
  "else": [
    { "action": "navigate", "args": ["/dashboard"] }
  ]
}
```

### and

```json
{
  "action": "condition",
  "and": [
    { "ref": "$url", "contains": "/login" },
    { "ref": "$title", "contains": "Sign in" }
  ],
  "then": [
    { "action": "log", "text": "auth failed" }
  ]
}
```

### or

```json
{
  "action": "condition",
  "or": [
    { "ref": "$url", "contains": "/login" },
    { "ref": "$title", "contains": "Login" }
  ],
  "then": [
    { "action": "log", "text": "auth failed" }
  ]
}
```

### Nested

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
  "then": [
    { "action": "log", "text": "auth failed" }
  ]
}
```

### Leaf operators

Use exactly one of:

- `eq`
- `neq`
- `gt`
- `lt`
- `contains`
- `exists`

Leaf form:

```json
{ "ref": "x", "eq": 1 }
```

## each

### Array

```json
{
  "action": "each",
  "ref": "items",
  "as": "item",
  "items": [
    { "action": "log", "text": "{{item.name}} @ {{$index}}" }
  ]
}
```

### Object

```json
{
  "action": "each",
  "ref": "config",
  "as": "{k, v}",
  "items": [
    { "action": "log", "text": "{{k}} = {{v}}" }
  ]
}
```

## loop

### Condition-based (preferred)

```json
{
  "action": "loop",
  "condition": { "ref": "$index", "lt": 5 },
  "items": [
    { "action": "click", "args": [".next"] },
    { "action": "log", "text": "index={{$index}}" }
  ]
}
```

### Count-based (backward compat)

```json
{
  "action": "loop",
  "count": 3,
  "items": [
    { "action": "click", "args": [".next"] }
  ]
}
```

`count` is converted internally to `condition: { ref: "$index", lt: count }`.

## try / catch / finally

```json
{
  "action": "try",
  "items": [
    { "action": "click", "args": ["Sign in"] }
  ],
  "catch": [
    { "action": "log", "text": "fallback error: {{$error}}" }
  ],
  "catch:challenge": [
    { "action": "wait", "args": ["user-action"], "prompt": "Solve the challenge, then click Continue" }
  ],
  "catch:notfound": [
    { "action": "log", "text": "element not found" }
  ],
  "catch:authFail": [
    { "action": "goto", "label": "login-flow" }
  ],
  "finally": [
    { "action": "screenshot", "args": ["--name=after-try"] }
  ]
}
```

Rules:

- `items` is required
- `catch` is fallback
- `catch:<name>` is typed handler (matches error type or named condition def)
- `finally` always runs
- Error info: `{{$error}}` (message), `{{$errorType}}` (classified type)

## Params (planned)

> Note: `--params` is not yet implemented. This section describes the planned syntax.

### CLI

```bash
pw sequence flow.json --params '{"url":"https://example.com"}'
pw sequence flow.json --params ./params/site-a.json
```

### Params usage

```json
{ "action": "navigate", "args": ["{{url}}"] }
```

## Params File Syntax

Params files are data-only.

### Allowed

```json
{
  "$id": "site-a",
  "load": ["./base.json", "./auth.json"],
  "url": "https://example.com",
  "credentials": [
    { "email": "a@test.com", "password": "secret" }
  ]
}
```

### Allowed keys

- `$id`
- `load`
- data fields

### Forbidden in params files

- `action`
- `def`
- `call`
- `condition`
- `each`
- `loop`
- `try`
- `catch`
- `finally`

## Validation Rules

### `condition`

Invalid:

```json
{
  "action": "condition",
  "ref": "x",
  "eq": 1,
  "or": [{ "ref": "y", "eq": 2 }]
}
```

Reason:

- cannot mix single leaf condition with `and` / `or`

Invalid:

```json
{
  "action": "condition",
  "and": [],
  "or": []
}
```

Reason:

- cannot use both `and` and `or` at the same level

### `def`

Invalid:

```json
{
  "action": "def",
  "name": "x",
  "type": "func",
  "items": []
}
```

with `type` being anything other than `"func"` or `"condition"`:

Reason:

- `def` type must be `"func"` or `"condition"`

### `try`

Invalid:

```json
{
  "action": "try",
  "catch": []
}
```

Reason:

- `try` requires `items`

### `each`

Invalid:

```json
{
  "action": "each",
  "ref": "items"
}
```

Reason:

- `each` requires `items`

### `loop`

Invalid:

```json
{
  "action": "loop",
  "items": []
}
```

Reason:

- `loop` requires `condition` or `count`
- `loop` requires `items`

### `shell`

Invalid:

```json
{
  "action": "shell"
}
```

Reason:

- `shell` requires `args`

### `wait` with `actions`

Invalid:

```json
{
  "action": "wait",
  "args": ["user-action"],
  "actions": []
}
```

Reason:

- `wait` "actions" must be a non-empty string array

### `out`

Invalid:

```json
{
  "action": "fetch",
  "args": ["GET", "/api"],
  "out": "$myVar"
}
```

Reason:

- `out` cannot start with `$` (reserved for built-in variables like `$index`, `$error`)

## Recommended Generation Style

- prefer short single-purpose steps
- prefer single-condition shorthand unless nesting is needed
- use `def` for repeated logic
- use params for data only
- use `catch:<name>` only when the named condition exists
- use `catch` as fallback
- use `finally` for cleanup
- use `items` for all block bodies (not `do`)
- use `condition` for loop control (not `count`)

## Example

```json
[
  {
    "action": "def",
    "name": "authFail",
    "type": "condition",
    "items": [
      { "ref": "$url", "contains": "/login" },
      { "ref": "$title", "contains": "Sign in" }
    ]
  },
  { "label": "start" },
  {
    "action": "try",
    "items": [
      { "action": "navigate", "args": ["{{url}}"] },
      { "action": "click", "args": ["Open dashboard"] }
    ],
    "catch:challenge": [
      { "action": "wait", "args": ["user-action"], "prompt": "Solve the challenge, then click Continue" },
      { "action": "goto", "label": "start" }
    ],
    "catch:authFail": [
      { "action": "goto", "label": "login-flow" }
    ],
    "catch": [
      { "action": "log", "text": "Unhandled error: {{$error}}" }
    ],
    "finally": [
      { "action": "screenshot" }
    ]
  }
]
```
