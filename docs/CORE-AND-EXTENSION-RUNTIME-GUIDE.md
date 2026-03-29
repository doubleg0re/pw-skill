# Core and Extension Runtime Guide

## Goal

Keep core lightweight.

- Core = thin runtime platform
- Extension = optional runtime product

Core should expose capabilities.
Extensions should use those capabilities to implement heavier features such as:

- persistent monitor
- tab-aware GUI or HUD
- runtime event streaming
- persistent user-action overlays

## Core Responsibilities

Core should own only the minimum platform surface needed for extensions to build on.

### 1. Runtime SDK Contract

Core should provide a stable runtime context to hooks, custom actions, and event handlers.

Minimum contract:

- `session`
- `cdpEndpoint`
- `emitEvent(event, payload)`
- `registerCleanup(fn)`
- `logger`
- lazy accessors:
  - `getBrowser()`
  - `getContext()`
  - `getPage()`

Guidelines:

- Keep capability loading lazy.
- Do not eagerly resolve browser/context/page unless requested.
- Treat `cdpEndpoint` as the main escape hatch for advanced runtime extensions.

### 2. Event Bridge

Core may generate and dispatch runtime events, but it should not become a long-running monitor by itself.

Recommended built-in events:

- `tab:created`
- `tab:closed`
- `tab:navigated`
- `tab:activated` (best-effort)

Rules:

- `emitEvent()` is fire-and-forget.
- Handler failures must never block core flow.
- Handler errors should be surfaced through `logger.warn`.

### 3. Stable Tab Identity

Core should expose a stable `tabId` model owned by pw-skill.

Do not rely on:

- Playwright page array index
- browser-specific ephemeral identifiers

Reason:

- Extensions need a stable handle for overlay persistence, monitor state, and GUI sync.

### 4. Manifest Loading and Validation

Core should load extension entries in a predictable and cross-platform-safe way.

Required support:

- `hooks`
- `actions`
- `events`

Rules:

- Use `pathToFileURL()` for ESM entry loading.
- Reject built-in action name collisions.
- Reject extension-to-extension action collisions.
- Validate manifest entries early and fail fast.

### 5. Cleanup Semantics

Core should guarantee that extension cleanup registrations can actually run.

Rules:

- `registerCleanup()` is for fine-grained runtime resource cleanup.
- `close` hook is for extension-level lifecycle shutdown.
- Both should coexist.

Expected behavior:

- If an extension starts a sidecar process, temporary resource, or monitor task, it should be able to register cleanup for it.
- Core should execute registered cleanups during shutdown paths.

## What Core Should Not Do

To preserve the lightweight design, core should avoid taking ownership of heavy runtime features.

Core should not:

- run a persistent monitor daemon by default
- embed WebSocket servers for all users
- implement GUI or HUD logic
- own idle-time browser observation between commands
- take on extension-specific runtime products

If those features are needed, they should live in extensions.

## Extension Responsibilities

Extensions should treat core as a capability provider, not as a full runtime manager.

### 1. Heavy Runtime Features

Extensions are the right place for:

- persistent CDP monitor
- WebSocket bridge
- native or browser-based GUI
- persistent user-action UX
- long-lived runtime observers

### 2. CDP Ownership

If an extension needs real-time observation while pw is idle, it should connect to the browser itself using `cdpEndpoint`.

Typical flow:

1. Launch hook receives runtime context.
2. Extension reads `cdpEndpoint`.
3. Extension starts its own monitor or sidecar.
4. Extension emits events back into the runtime bridge as needed.

### 3. Event Namespacing

Extension-defined custom events should use namespacing.

Recommended format:

- `packageName:event`

Examples:

- `pw-runtime-monitor:overlay-restored`
- `pw-persist-user-action:pending-updated`

Reason:

- Avoid collisions between unrelated extensions.

### 4. Process Management

Extensions that spawn sidecars or helper processes should assume responsibility for cleanup.

Recommended rules:

- Register cleanup callbacks for spawned processes.
- Avoid unmanaged background processes.
- If a core helper such as `spawnSidecar()` exists later, prefer it over raw spawn calls.

### 5. Event Semantics

Extensions should not treat `emitEvent()` as a request-response mechanism.

Important rule:

- Events are notifications, not commands.

If the extension needs:

- a result
- a blocking response
- a negotiated action

then it should use a different pattern such as:

- custom action
- hook contract
- explicit call path

## Recommended Rollout Order

### Phase 1. Core SDK Stabilization

Ship and lock down:

- runtime context contract
- cleanup semantics
- event dispatch policy
- stable tab identity

### Phase 2. Core Event Contract

Stabilize and document:

- `tab:created`
- `tab:closed`
- `tab:navigated`
- `tab:activated` as best-effort

### Phase 3. Extension Runtime Products

Build optional extensions such as:

- runtime monitor
- persistent user-action
- tab-aware GUI

## Example Target Architecture

- Core:
  - session lifecycle
  - sequence engine
  - runtime SDK
  - event bridge
- Extension:
  - CDP monitor
  - sidecar process
  - custom actions
  - event handlers
  - GUI/HUD

## Practical Rule of Thumb

If a feature increases:

- background process count
- transport complexity
- dependency weight
- idle-time monitoring scope

it probably belongs in an extension, not in core.

## Summary

The intended split is simple:

- Core provides capabilities.
- Extensions build products.

That keeps pw-skill lightweight while still allowing powerful optional runtime features through rary packages.
