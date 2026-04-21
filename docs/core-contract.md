# hot.js Core Contract

## 1. Identity

hot.js is a **minimal hot-reload engine for plain JavaScript development**.  
It focuses on fast, predictable feedback during development without bundling, compiling, or framework lock-in.

---

## 2. Core Guarantee

When a watched file changes, **hot.js updates the running environment without a full reload**, preserving as much useful state as possible while keeping behavior deterministic.

---

## 3. Change Detection

- **hot.js watches the filesystem** (or equivalent source of truth) for changes.
- A change is normalized into a **structured event**:
  - **path**
  - **type** (`created`, `modified`, `deleted`)
  - **timestamp**
- This event is the only primitive hot.js assumes about the outside world.

---

## 4. Module Boundary

- hot.js treats each file as a **module boundary**.
- On change, hot.js:
  - **only reloads modules that changed**, plus any explicitly configured dependents.
  - **never reloads the entire graph** unless explicitly requested.
- Module resolution is **transparent**: hot.js does not invent its own module system.

---

## 5. State Boundary

- By default, **hot.js preserves runtime state** across reloads where it is safe to do so.
- State that is:
  - **local to a module** may be reinitialized on reload.
  - **external or user-managed** (e.g., stores, global singletons) is **not reset** unless explicitly configured.
- hot.js does **not** guess at “smart” state migrations; it prefers **explicitness over magic**.

---

## 6. Error Boundary

- If a reload fails (syntax error, runtime error on import, etc.):
  - hot.js **surfaces the error** clearly.
  - hot.js **does not crash the entire session**.
  - the previous working version remains effectively intact until a valid change is applied.
- Errors are treated as **first-class events**, not swallowed or hidden.

---

## 7. Transport & Protocol

- hot.js communicates changes via a **simple, documented protocol**:
  - `file change → event → reload request → result`
- The transport (WebSocket, HTTP, stdin/stdout, etc.) is **pluggable** and **not baked into the core**.
- The protocol is **stable and minimal**, so other tools can integrate without depending on internal details.

---

## 8. Non-Goals

hot.js explicitly **does not**:

- bundle, transpile, or minify code  
- perform framework-specific magic (React/Vue/Svelte/etc.)  
- manage routing, assets, or HTML shells  
- act as a full dev server or build tool  

It is a **hot-reload engine**, not a framework or bundler.

---

## 9. Integration Surface

- hot.js can be embedded into any dev server or tool via a **small, explicit API**:
  - provide change events
  - receive reload instructions / results
- Integration should require **one clear hook**, not deep coupling.

---

## 10. Determinism & Predictability

- Given the same:
  - file graph  
  - change event  
  - configuration  
- hot.js will produce the **same reload behavior** every time.
- No hidden global state, no implicit heuristics, no “sometimes it works” behavior.

hot.js optimizes for **clarity, determinism, and minimal surprise** over cleverness or hidden automation.

---

## 11. v1 Provisional Guardrails

To avoid freezing design too early, hot.js v1 keeps most implementation details flexible.  
This section defines only the minimum guarantees that MUST remain stable through MVP iteration:

- **Canonical change event**: hot.js treats a file change as an event with:
  - **path**
  - **type** (`created`, `modified`, `deleted`)
  - **timestamp**
- **No implicit full-graph reloads**: hot.js MUST NOT reload the entire module graph unless explicitly configured or requested.
- **Reload failure isolation**: if a reload fails, hot.js MUST surface the error and keep the session alive with the last known working runtime effectively intact.
- **Pluggable transport**: core behavior MUST remain transport-agnostic; transport is replaceable (WebSocket, HTTP, stdin/stdout, etc.) without changing core semantics.
- **Deterministic outcomes**: given the same file graph, change event, and configuration, hot.js MUST produce the same reload behavior.

All other API shapes, internal architecture, and integration details are provisional during MVP and may change before stable release.

---

## 12. Reload Pipeline (Internal Execution Flow)

hot.js processes every file change through a deterministic pipeline:

1. **Receive Change Event**  
   A normalized `{ path, type, timestamp }` event enters the system.

2. **Queue Event**  
   Events are queued in arrival order.  
   Only one reload runs at a time.

3. **Coalesce Rapid Changes**  
   If multiple events affect the same file before reload begins,  
   hot.js keeps only the latest (last-write-wins).

4. **Determine Affected Modules**  
   hot.js computes the reload set using:
   - the changed module  
   - any dependents (static graph or resolver)  
   - any explicitly configured modules

5. **Prepare Reload Context**  
   hot.js constructs a context object containing:
   - changed file  
   - reload set  
   - preserved state modules  
   - timestamps  
   - previous reload result (if any)

6. **Run Lifecycle Hooks**  
   - `beforeReload(ctx)`  
   - (reload attempt)  
   - `afterReload(ctx)` or `onReloadError(ctx)`

7. **Apply Reload**  
   hot.js reloads modules in a deterministic order:
   - delete old module instance  
   - re-import module  
   - re-bind exports  
   - preserve external state if configured

8. **Emit Result**  
   hot.js emits a structured result:
   - `status: "ok" | "error"`  
   - `reloadedModules`  
   - `preservedStateModules`  
   - `error` (if any)

9. **Continue Queue**  
   After finishing, hot.js processes the next event in the queue.

