# Sequence Syntax

Minimal syntax reference for AI-generated `pw sequence` flows.

## Root

Sequence input may be either a JSON array of steps or an object with `info` and `flow`.

```json
[
  { "action": "navigate", "args": ["https://example.com"] }
]
```

```json
{
  "info": {
    "parameters": ["baseUrl", "credentials"]
  },
  "flow": [
    { "action": "navigate", "args": ["{{baseUrl}}/login"] }
  ]
}
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
- `type`
- `params`
- `items`
- `ref`
- `text`
- `then`
- `else`
- `catch`
- `catch:<name>`
- `finally`
- `condition`
- `target`
- `trigger`
- `timeout`
- `actions`
- `prompt`
- `focus`
- `idle`

A step is either a normal step (`action` + fields) or a comment-only step (`comment` only): a step **cannot carry both `comment` and `action`** (`step cannot have both "comment" and "action"`). To annotate a step, use a separate comment-only step next to it.

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
- `{{$ret}}`
- `{{$err}}`
- `{{$code}}`
- `{{$elem}}`

## Basic Actions

```json
{ "action": "navigate", "args": ["https://example.com"] }
{ "action": "click", "args": ["Sign in"] }
{ "action": "fill", "args": ["#email", "{{email}}"] }
{ "action": "wait", "args": ["1000"] }
{ "action": "wait", "target": "user-action", "prompt": "Solve the challenge, then click Continue" }
{ "action": "log", "text": "done" }
{ "action": "goto", "label": "start" }
```

## evaluate

With no extra args, `args[0]` is a JS **expression** run in the page:

```json
{ "action": "evaluate", "args": ["document.title"], "out": "title" }
```

Interpolated `{{params}}` are substituted as **raw text into the expression**, so a value containing quotes or newlines breaks the source (page-side `SyntaxError`). Instead, make `args[0]` a **function** and pass values as **additional args** — they arrive as serialized data (verbatim), never pasted into source:

```json
{ "action": "evaluate", "args": ["(sel) => document.querySelector(sel)?.textContent", "{{selector}}"], "out": "text" }
{ "action": "evaluate", "args": ["(a, b) => a + b", 2, 3] }
```

The caller passes `{{selector}}` / values verbatim — no quoting decision anywhere. A lone function literal (`() => …`) with no extra args is **called** (not returned as an unusable function object), so its body runs.

## return

```json
{ "action": "return", "value": "{{me.id}}" }
```

`return` takes a **`value`** (a `ref` is rejected: `return requires "value"`) and is **only allowed inside a `def type="flow"` subflow** (`return is only allowed inside def type="flow" subflows`). A **standalone flow cannot use `return`** — it already yields its **last step's data** as `{{$ret}}`, so deliver a result by making it the last step.

## set

Copy values into user-defined variables.

```json
{
  "action": "set",
  "items": {
    "savedElem": { "ref": "$elem" },
    "savedRet": { "ref": "$ret" },
    "duplicatedVal": { "ref": "previousVal" },
    "retryCount": { "value": 3 },
    "payload": { "value": { "ok": true, "items": [1, 2, 3] } }
  }
}
```

Rules:

- each entry value must contain exactly one of:
  - `ref`
  - `value`
- destination variable names must not start with `$`

## Label / Goto

```json
[
  { "label": "start" },
  { "action": "click", "args": [".retry"] },
  { "action": "goto", "label": "start" }
]
```

## shell

Execute a local command. Requires `--allow-shell`. With `--request-permission`, prompts the user for approval before each execution (requires `--headed`).

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

## wait

### Time wait

```json
{ "action": "wait", "args": ["1000"] }
```

### Observation wait

```json
{
  "action": "wait",
  "target": "dom:#login .email[value]",
  "trigger": {
    "ref": "$changed",
    "eq": true
  },
  "timeout": 10000,
  "out": "emailWatch"
}
```

Supported target forms:

- `dom:<selector>`
- `dom:<selector>[field]`
- `url:<pattern>`
- `challenge`

Trigger uses the same condition grammar as `condition`.

### user-action

Pause execution and show an overlay with action buttons. The clicked button value is stored in `out`.

```json
{
  "action": "wait",
  "target": "user-action",
  "prompt": "Choose an action",
  "actions": ["approve", "skip", "cancel"],
  "out": "choice"
}
```

- `actions`: Array of button labels (default: `["continue"]` when omitted)
- `out`: Stores the clicked button value
- `focus`: Optional selector to focus before waiting
- `idle`: Optional idle milliseconds before showing actions

### user-alert

```json
{
  "action": "wait",
  "target": "user-alert",
  "prompt": "Please submit the form manually."
}
```

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

### Block call

```json
{ "action": "call", "name": "login", "args": ["admin@test.com", "secret"] }
```

```json
{ "action": "call", "name": "login", "args": { "email": "admin@test.com", "pass": "secret" } }
```

### Flow definition (external subflow)

`def type="flow"` loads a flow from another file by `path` (resolved from the current flow's directory):

```json
{ "action": "def", "name": "composer", "type": "flow", "path": "./composer.json" }
```

The **callee file must declare `info.type: "subflow"`** (otherwise `Subflow info.type must be "subflow"`); a plain standalone flow will not load as a subflow:

```json
{ "info": { "type": "subflow", "parameters": ["text"] }, "flow": [ ... ] }
```

Relative paths inside the subflow resolve from the subflow's own directory, and `return` is allowed here (unlike a standalone flow).

### Condition definition

```json
{
  "action": "def",
  "name": "authFail",
  "type": "condition",
  "items": {
    "or": [
      { "ref": "$url", "contains": "/login" },
      { "ref": "$title", "contains": "Sign in" }
    ]
  }
}
```

When `type` is `"condition"`, `items` must be a single `ConditionNode`.

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

```json
{
  "action": "loop",
  "condition": {
    "and": [
      { "ref": "$index", "lt": 10 },
      { "ref": "found", "neq": true }
    ]
  },
  "items": [
    { "action": "find", "args": ["#success-banner"], "out": "found" },
    { "action": "wait", "args": ["1000"] }
  ]
}
```

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
    { "action": "wait", "target": "user-action", "prompt": "Solve the challenge, then click Continue" }
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
- `catch:<name>` is typed handler
- `finally` always runs
- Error info: `{{$error}}` (message), `{{$errorType}}` (classified type)

## Params

### CLI

```bash
pw sequence flow.json --params '{"url":"https://example.com"}'
pw sequence flow.json --params ./params/site-a.json
```

### Params usage

```json
{ "action": "navigate", "args": ["{{url}}"] }
```

### Top-level parameter contract

When the root object declares `info.parameters`, `--params` must provide exactly those keys.

```json
{
  "info": {
    "parameters": ["url", "credentials"]
  },
  "flow": [
    { "action": "navigate", "args": ["{{url}}"] },
    { "action": "fill", "args": ["#email", "{{credentials.email}}"] }
  ]
}
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
  "items": []
}
```

Reason:

- `def` requires `type`
- `def` type must be `"func"` or `"condition"`
- `def` requires `items`

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

- `loop` requires `condition`
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
  "target": "user-action",
  "actions": []
}
```

Reason:

- `wait` "actions" must be a non-empty string array

### `set`

Invalid:

```json
{
  "action": "set",
  "items": {
    "$bad": { "ref": "$ret" }
  }
}
```

Reason:

- `set` destination names cannot start with `$`

Invalid:

```json
{
  "action": "set",
  "items": {
    "x": { "ref": "a", "value": 1 }
  }
}
```

Reason:

- `set` item must contain exactly one of `ref` or `value`

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

- `out` cannot start with `$` (reserved for built-in variables)

## Recommended Generation Style

- prefer short single-purpose steps
- prefer single-condition shorthand unless nesting is needed
- use `def` for repeated logic
- use params for data only
- use `catch:<name>` only when the named condition exists
- use `catch` as fallback
- use `finally` for cleanup
- use `items` for all block bodies
- use `condition` for loop control

## Example

```json
[
  {
    "action": "def",
    "name": "authFail",
    "type": "condition",
    "items": {
      "or": [
        { "ref": "$url", "contains": "/login" },
        { "ref": "$title", "contains": "Sign in" }
      ]
    }
  },
  { "label": "start" },
  {
    "action": "try",
    "items": [
      { "action": "navigate", "args": ["{{url}}"] },
      { "action": "click", "args": ["Open dashboard"] }
    ],
    "catch:challenge": [
      { "action": "wait", "target": "user-action", "prompt": "Solve the challenge, then click Continue" },
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
