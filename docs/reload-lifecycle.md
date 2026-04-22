# hot.js — Reload Lifecycle Specification

**Version:** 0.1.0  
**Status:** Normative (Pre-MVP)
**Doctrine:** Hookless Substrate  
**Date:** 2026-04-22  

---

## 1. Purpose & Scope

This document defines the **complete, deterministic reload lifecycle** for hot.js.

hot.js is a **host-level runtime orchestrator** — it watches the filesystem, computes what changed, and restarts the affected module graph. It is not a bundler, not an HMR framework, and not a runtime owner. It owns exactly one thing: the reload.

This specification is the **single source of truth** for all reload behavior. Any implementation that contradicts this document is non-conformant.

### 1.1 What This Spec Governs

- The lifecycle state machine and its transitions.
- The computation of ReloadSets from dependency graphs.
- SCC-atomic reload, evaluation, commit, and rollback semantics.
- Cancellation via supersession.
- The error model and classification.
- Integration mode contracts (Process Supervisor, Signal, WebSocket Bridge).

### 1.2 What This Spec Does Not Govern

- UI state, framework state, or application state.
- Bundler behavior, HMR protocols, or hydration.
- Any runtime behavior inside the user's application.

---

## 2. Hookless Substrate Doctrine

**Hooks are permanently out of scope for hot.js.**

This is not a deferral. It is a closed architectural decision.

### 2.1 Rationale

hot.js has exactly two goals:

1. Reload **deterministically**.
2. Reload **quickly**.

Any feature that introduces user-defined execution points inside the reload pipeline — `beforeReload`, `afterReload`, `onModuleLoad`, `onError`, or any equivalent — is a **nondeterminism vector**. It violates Goal 1. If it blocks, it violates Goal 2.

### 2.2 The Five Zeroes

| Zero | Meaning |
|---|---|
| Zero userland influence | No user code executes inside the reload pipeline. |
| Zero nondeterminism vectors | No callbacks, no event emitters, no async interception points. |
| Zero hidden dependencies | The reload depends only on the file change and the dependency graph. |
| Zero global state | The pipeline carries no mutable state between reloads. |
| Zero opinion | hot.js has no opinion about frameworks, renderers, state shape, or UI. |

### 2.3 Consequence

The reload pipeline is a **pure function** of:

```
Reload = f(ChangedFiles, DependencyGraph, Config)
```

Nothing else enters. Nothing else influences. The pipeline is closed.

### 2.4 What Users Do Instead

Users who need pre/post-reload behavior implement it **outside hot.js**, in their own process, using the integration modes defined in §11. hot.js emits structured Sig events (§3); consumers react to them. The boundary is absolute.

---

## 3. Glossary

| Term | Definition |
|---|---|
| **Module** | A single JavaScript/TypeScript file identified by its resolved absolute path. The atomic unit of source. |
| **SCC** | Strongly Connected Component. A maximal set of modules where every module is reachable from every other module via imports. The atomic unit of reload. |
| **SCC Key** | A deterministic, lexicographically sorted, comma-joined string of the resolved absolute paths of all modules in the SCC. Immutable for a given graph topology. |
| **Sig** | A structured, read-only signal emitted by hot.js at defined lifecycle transitions. Sigs are the sole external communication channel. They carry data; they accept no response. |
| **ReloadSet** | The computed set of SCCs that must be reloaded in response to a set of file changes. Derived from the dependency graph. |
| **Reload** | A single, atomic pass through the lifecycle state machine from `Triggered` to `Idle`. |
| **Supersession** | The mechanism by which a newer Reload cancels an in-flight older Reload. |
| **Epoch** | A monotonically increasing integer assigned to each Reload. Epochs are never reused. |
| **Verdict** | The final classification of a completed Reload: `committed`, `rolled-back`, or `superseded`. |
| **DependencyGraph** | A directed graph where nodes are Modules and edges are static import relationships, computed via AST extraction. |
| **Quiescence** | The state in which no further changes are propagating and the system is idle. |
| **Config** | The hot.js configuration, read once at startup. Immutable for the lifetime of the process. |

---

## 4. Core Model

### 4.1 The Dependency Graph

The DependencyGraph is constructed by **static import extraction** (AST-level, not runtime). It is recomputed on every Reload.

- **Nodes** are Modules (resolved absolute paths).
- **Edges** are static `import`/`require` declarations.
- Dynamic imports (`import()`) are **excluded**. They are runtime constructs and cannot be statically determined.

### 4.2 SCC Decomposition

The DependencyGraph is decomposed into SCCs using Tarjan's algorithm (or equivalent). The resulting **SCC DAG** (directed acyclic graph of SCCs) defines the reload order.

**Invariant:** The SCC DAG is always acyclic. If Tarjan's produces a cycle among SCCs, the implementation is non-conformant.

### 4.3 Topological Order

The SCC DAG is topologically sorted. SCCs are reloaded in **reverse topological order** — leaves first, roots last. This guarantees that when an SCC is evaluated, all of its dependencies have already been evaluated.

### 4.4 Epoch Assignment

Each Reload is assigned a unique, monotonically increasing Epoch at the moment it enters `Triggered`. Epochs are unsigned 64-bit integers. Overflow is a fatal error.

---

## 5. Lifecycle State Machine

A Reload passes through exactly these states, in exactly this order. There are no optional states, no conditional branches, and no loops.

```
Idle → Triggered → Computing → Executing → Committing → Reporting → Idle
                                    ↓             ↓
                                 Failing → Reporting → Idle
```

### 5.1 State Definitions

#### `Idle`

The system is quiescent. No Reload is in progress. The watcher is active.

- **Entry condition:** System startup, or previous Reload reached `Reporting → Idle`.
- **Exit condition:** A file-change event is received from the watcher.
- **Sig emitted:** None.

#### `Triggered`

A file-change event has been received. The Reload is born.

- **Entry condition:** Watcher delivers one or more changed file paths.
- **Actions:**
  1. Assign a new Epoch (previous Epoch + 1).
  2. Record the set of changed file paths (the **trigger set**).
  3. Start the debounce window (if configured). Additional file changes arriving within the debounce window are merged into the same trigger set. The Epoch does not change.
- **Exit condition:** Debounce window closes (or no debounce configured).
- **Sig emitted:** `sig:triggered { epoch, triggerSet }`.

#### `Computing`

The ReloadSet is being computed from the trigger set and the DependencyGraph.

- **Entry condition:** `Triggered` completes.
- **Actions:**
  1. Re-extract the DependencyGraph from the current filesystem state via static AST analysis.
  2. Decompose into SCCs (§6).
  3. Compute the ReloadSet (§7).
  4. Topologically sort the ReloadSet.
- **Exit condition:** ReloadSet computation completes.
- **Sig emitted:** `sig:computed { epoch, reloadSet, sccCount }`.
- **Error transition:** If graph extraction fails (parse error, filesystem error), transition to `Failing`.

#### `Executing`

Each SCC in the ReloadSet is being re-evaluated in topological order.

- **Entry condition:** `Computing` completes with a non-empty ReloadSet.
- **Actions:**
  1. For each SCC in the topologically sorted ReloadSet:
     a. Invalidate all modules in the SCC from the module cache.
     b. Re-evaluate all modules in the SCC. Evaluation order within an SCC is determined by the SCC Key sort order (lexicographic by resolved path).
     c. If any module in the SCC throws during evaluation, the **entire SCC fails** (§6.3).
  2. If the ReloadSet is empty, skip directly to `Committing`.
- **Exit condition:** All SCCs in the ReloadSet have been evaluated without error.
- **Error transition:** If any SCC fails evaluation, transition to `Failing`.
- **Sig emitted:** `sig:scc-evaluated { epoch, sccKey }` after each successful SCC evaluation.

#### `Committing`

The Reload is finalized. The new module state becomes the live state.

- **Entry condition:** `Executing` completes without error.
- **Actions:**
  1. The module cache now reflects the reloaded modules. No rollback is possible after this point.
  2. Assign verdict: `committed`.
- **Exit condition:** Commit completes.
- **Sig emitted:** `sig:committed { epoch, verdict: "committed", reloadSet }`.

#### `Failing`

An error occurred during `Computing` or `Executing`. The Reload is being rolled back.

- **Entry condition:** Error during `Computing` or `Executing`.
- **Actions:**
  1. Restore the module cache to its pre-Reload state for all SCCs that have not yet been committed. SCCs that were successfully evaluated but not yet committed are rolled back.
  2. Record the error with its classification (§10).
  3. Assign verdict: `rolled-back`.
- **Exit condition:** Rollback completes.
- **Sig emitted:** `sig:failed { epoch, verdict: "rolled-back", error }`.

#### `Reporting`

Terminal bookkeeping state. The Reload's verdict is finalized and recorded.

- **Entry condition:** `Committing` or `Failing` completes.
- **Actions:**
  1. Emit the terminal Sig (either `sig:committed` or `sig:failed` was already emitted; `sig:report` is the final accounting Sig).
  2. Clear all transient Reload state.
  3. Return to `Idle`.
- **Exit condition:** Immediate.
- **Sig emitted:** `sig:report { epoch, verdict, durationMs }`.

### 5.2 State Transition Table

| From | To | Condition |
|---|---|---|
| `Idle` | `Triggered` | File-change event received. |
| `Triggered` | `Computing` | Debounce window closes. |
| `Computing` | `Executing` | ReloadSet computed successfully. |
| `Computing` | `Failing` | Graph extraction or ReloadSet computation error. |
| `Executing` | `Committing` | All SCCs evaluated successfully. |
| `Executing` | `Failing` | Any SCC evaluation throws. |
| `Committing` | `Reporting` | Commit completes. |
| `Failing` | `Reporting` | Rollback completes. |
| `Reporting` | `Idle` | Always. |

### 5.3 Prohibited Transitions

All transitions not listed in §5.2 are **illegal**. An implementation that permits any unlisted transition is non-conformant. There is no `Idle → Computing`, no `Executing → Triggered`, no `Failing → Executing`.

---

## 6. SCC Semantics

SCCs are the **atomic unit of reload**. This is non-negotiable.

### 6.1 SCC Identity

An SCC is identified by its **SCC Key**: the lexicographically sorted, comma-joined resolved absolute paths of all modules in the SCC.

```
SCC Key = sort(modules.map(m => m.resolvedPath)).join(",")
```

If the dependency graph changes such that an SCC's membership changes, its SCC Key changes. It is a **new SCC**. There is no SCC identity continuity across topology changes.

### 6.2 SCC Atomicity

All modules in an SCC are:

- **Invalidated together.** You cannot invalidate a subset of an SCC's modules.
- **Evaluated together.** All modules in the SCC are re-evaluated in a single pass.
- **Committed together.** If the SCC succeeds, all modules are committed atomically.
- **Rolled back together.** If any module in the SCC fails evaluation, all modules in the SCC are rolled back to their pre-Reload state.

There is no partial SCC reload.

### 6.3 SCC Failure Semantics

If **any** module in an SCC throws during evaluation:

1. The entire SCC is marked as failed.
2. All modules in the SCC are rolled back.
3. All **downstream SCCs** (SCCs that depend on this SCC) are **skipped**. They are not evaluated.
4. The Reload transitions to `Failing`.
5. The error is recorded with the SCC Key and the specific module that threw.

### 6.4 Singleton SCCs

A module with no circular dependencies forms a **singleton SCC** — an SCC containing exactly one module. Singleton SCCs obey all the same rules. There is no special case.

---

## 7. ReloadSet Computation

The ReloadSet is the set of SCCs that must be reloaded in response to a trigger set.

### 7.1 Algorithm

```
Given: triggerSet (set of changed file paths), DependencyGraph

1. Resolve each path in triggerSet to its Module node in the DependencyGraph.
   - If a path does not correspond to a known Module, it is ignored.
   - If a path corresponds to a Module not in the current graph (new file),
     re-extract the full DependencyGraph first.

2. For each resolved Module, find its containing SCC.
   → This produces the "directly affected SCCs."

3. Compute the transitive closure of dependents in the SCC DAG:
   - For each directly affected SCC, collect all SCCs that transitively
     depend on it (upstream in the import direction, downstream in the
     "affected by change" direction).

4. The ReloadSet = directlyAffectedSCCs ∪ transitivelyAffectedSCCs.

5. Topologically sort the ReloadSet (leaves first, roots last).
```

### 7.2 Empty ReloadSet

If the trigger set resolves to zero known Modules (e.g., a non-imported file was saved), the ReloadSet is empty. The Reload transitions through `Executing` (no-op) and `Committing` with verdict `committed`. A `sig:report` is still emitted.

### 7.3 Full Reload

If the ReloadSet equals the full set of SCCs in the DependencyGraph, this is a **full reload**. There is no special handling. The same algorithm applies. hot.js does not distinguish partial from full reloads architecturally.

### 7.4 ReloadSet Determinism

Given identical `triggerSet`, `DependencyGraph`, and `Config`, the ReloadSet computation **must** produce identical output. This is a hard invariant. Non-deterministic ReloadSet computation is a conformance failure.

---

## 8. Normative Reload Algorithm

This section defines the complete algorithm as a single linear sequence. All behavior described in §5–§7 is restated here in execution order for implementor clarity.

```
RELOAD(triggerSet):

  01. epoch ← previousEpoch + 1
  02. EMIT sig:triggered { epoch, triggerSet }
  
  03. IF debounce is configured:
  04.   WAIT debounce window; merge additional file changes into triggerSet
  
  05. graph ← EXTRACT_DEPENDENCY_GRAPH(filesystem)
  06.   ON ERROR: GOTO 20
  
  07. sccs ← TARJAN(graph)
  08. reloadSet ← COMPUTE_RELOAD_SET(triggerSet, graph, sccs)
  09. sortedReloadSet ← TOPOLOGICAL_SORT(reloadSet)
  10. EMIT sig:computed { epoch, reloadSet, sccCount }
  
  11. IF superseded(epoch):
  12.   verdict ← "superseded"
  13.   EMIT sig:report { epoch, verdict, durationMs }
  14.   RETURN
  
  15. FOR EACH scc IN sortedReloadSet:
  16.   INVALIDATE scc.modules FROM cache
  17.   EVALUATE scc.modules IN lexicographic order
  18.     ON ERROR: GOTO 20
  19.   EMIT sig:scc-evaluated { epoch, scc.key }
  
      — Check supersession between SCCs —
  19a. IF superseded(epoch):
  19b.   ROLLBACK all invalidated-but-uncommitted SCCs
  19c.   verdict ← "superseded"
  19d.   EMIT sig:report { epoch, verdict, durationMs }
  19e.   RETURN
  
  20. — Error path —
  21.   ROLLBACK all invalidated-but-uncommitted SCCs
  22.   verdict ← "rolled-back"
  23.   EMIT sig:failed { epoch, verdict, error }
  24.   EMIT sig:report { epoch, verdict, durationMs }
  25.   RETURN
  
  26. — Success path —
  27. COMMIT all evaluated SCCs to live cache
  28. verdict ← "committed"
  29. EMIT sig:committed { epoch, verdict, reloadSet }
  30. EMIT sig:report { epoch, verdict, durationMs }
  31. RETURN
```

---

## 9. Cancellation & Supersession

### 9.1 Supersession Rule

If a new file-change event arrives while a Reload is in-flight (in any state other than `Idle`), the new event **supersedes** the current Reload.

- The current Reload is marked with verdict `superseded`.
- All invalidated-but-uncommitted SCCs in the current Reload are **rolled back**.
- The new Reload begins at `Triggered` with a new Epoch.

### 9.2 Supersession Check Points

Supersession is checked at exactly two points:

1. **After `Computing`, before `Executing` begins** (line 11 in §8).
2. **Between SCC evaluations** during `Executing` (line 19a in §8).

Supersession is **not** checked mid-evaluation within a single SCC. SCC evaluation is atomic and uninterruptible.

### 9.3 Supersession is Not Cancellation

Supersession is **structural**, not cooperative. There is no "cancel token," no abort signal, no graceful shutdown negotiation. The superseded Reload's remaining work is simply not performed. Already-evaluated-but-uncommitted SCCs are rolled back.

### 9.4 Supersession Sig

A superseded Reload emits:

```
sig:report { epoch, verdict: "superseded", durationMs }
```

No `sig:committed` or `sig:failed` is emitted for a superseded Reload.

### 9.5 Debounce Interaction

If a new file change arrives during the debounce window of a `Triggered` Reload, it is **merged** into the existing trigger set. The Epoch does not change. This is coalescence, not supersession. Supersession only applies to changes arriving **after** the debounce window closes.

---

## 10. Error Model

### 10.1 Error Classification

All errors are classified into exactly one of these categories:

| Error Key | Phase | Description |
|---|---|---|
| `ERR_PARSE` | Computing | A module failed to parse (syntax error). |
| `ERR_RESOLVE` | Computing | A module's import target could not be resolved. |
| `ERR_FS` | Computing | Filesystem I/O error during graph extraction. |
| `ERR_EVAL` | Executing | A module threw during evaluation. |
| `ERR_CYCLE_DEGENERATE` | Computing | Tarjan's algorithm detected a degenerate graph structure (implementation guard). |
| `ERR_INTERNAL` | Any | An error in hot.js itself, not attributable to user code or filesystem. |

### 10.2 Error Shape

All errors emitted via Sigs conform to this shape:

```
{
  key:       string,       // One of the ERR_* keys above.
  epoch:     number,       // The Epoch of the Reload that failed.
  phase:     string,       // "computing" | "executing"
  module:    string | null, // Resolved path of the module that caused the error, if applicable.
  sccKey:    string | null, // SCC Key of the affected SCC, if applicable.
  message:   string,       // Human-readable error message.
  cause:     Error | null   // The underlying error object, if available.
}
```

### 10.3 Error Recovery

hot.js does **not** implement automatic retry. A failed Reload returns to `Idle`. The next file-change event triggers a new Reload, which may succeed if the error has been fixed.

There is no error memory. Each Reload starts clean. A module that failed in Epoch N has no penalty, flag, or special treatment in Epoch N+1.

### 10.4 Fatal Errors

The following errors are **fatal** — hot.js terminates the process:

- Epoch overflow (unsigned 64-bit integer exceeded).
- `ERR_INTERNAL` occurring three times consecutively without a successful Reload between them.
- Watcher subsystem failure (underlying `fs.watch` or equivalent becomes unrecoverable).

All other errors are **recoverable** and result in a `rolled-back` verdict.

---

## 11. Integration Modes

hot.js exposes three integration modes. All three are **external** — they consume Sigs from outside the reload pipeline. None of them inject behavior into the pipeline.

### 11.1 Process Supervisor Mode

hot.js spawns and owns the user's process as a child process.

- On `sig:committed`: hot.js sends `SIGTERM` to the child, waits for exit (with configurable timeout), then respawns.
- On `sig:failed`: hot.js logs the error. The child continues running with the previous module state.
- On `sig:report { verdict: "superseded" }`: No action. The superseding Reload will handle the restart.

This is the **default mode**.

### 11.2 POSIX Signal Mode

hot.js sends a configurable POSIX signal (default: `SIGUSR2`) to a target PID.

- On `sig:committed`: hot.js sends the configured signal to the target PID.
- The target process is responsible for handling the signal and reloading itself.
- hot.js does not own, spawn, or manage the target process.

### 11.3 WebSocket Bridge Mode

hot.js exposes a local WebSocket server that forwards Sigs as JSON messages.

- On any Sig emission, the corresponding Sig payload is serialized to JSON and broadcast to all connected WebSocket clients.
- Clients may be dev servers, browser extensions, or custom tooling.
- The WebSocket bridge is **read-only**. Clients cannot send commands to hot.js. The bridge accepts no inbound messages.
- The bridge binds to `localhost` only. It is not exposed to the network.

### 11.4 Mode Exclusivity

Modes are **not exclusive**. An implementation MAY support running multiple modes simultaneously (e.g., Process Supervisor + WebSocket Bridge). The modes are orthogonal; they do not interact.

---

## 12. Invariants

These invariants hold for every Reload, unconditionally. Violating any of them is a conformance failure.

### 12.1 Determinism Invariant

> Given identical `triggerSet`, `DependencyGraph`, and `Config`, the Reload produces identical `ReloadSet`, identical evaluation order, and identical `verdict` (absent non-determinism in user module evaluation).

### 12.2 Atomicity Invariant

> An SCC is the atomic unit of reload. There is no partial SCC invalidation, evaluation, commit, or rollback.

### 12.3 Purity Invariant

> The reload pipeline is a pure function of `(ChangedFiles, DependencyGraph, Config)`. No user code, no callbacks, no hooks, no event handlers, and no external state influence the pipeline.

### 12.4 Monotonic Epoch Invariant

> Epochs are monotonically increasing unsigned integers. A Reload with Epoch N always started before a Reload with Epoch N+1. Epochs are never reused, never decremented, never reset.

### 12.5 Quiescence Invariant

> If no file-change events arrive, the system reaches `Idle` in finite time and remains there. The system never self-triggers.

### 12.6 Supersession Invariant

> A superseded Reload never commits. Its evaluated-but-uncommitted SCCs are always rolled back before the superseding Reload begins `Computing`.

### 12.7 Order Invariant

> SCCs in the ReloadSet are evaluated in reverse topological order of the SCC DAG. When an SCC is evaluated, all SCCs it depends on have already been evaluated in this Reload (or were not in the ReloadSet and are therefore unchanged).

### 12.8 No-Opinion Invariant

> hot.js carries no assumptions about the semantics of the modules it reloads. It does not know or care about React, Vue, Svelte, Express, state, UI, DOM, SSR, hydration, or any other framework or runtime concept.

---

## 13. Contracts & Guarantees

### 13.1 To the User

- **Deterministic behavior.** Same input, same output.
- **No side-channel influence.** Nothing outside `(ChangedFiles, DependencyGraph, Config)` affects the Reload.
- **Atomic failure.** If a Reload fails, the previous working state is fully restored.
- **Structured observability.** All lifecycle transitions are observable via Sigs.
- **No magic.** No auto-wiring, no decorators, no hidden behavior.

### 13.2 To the Implementation

- **Config is immutable.** Read once at startup. Changes to config require a process restart.
- **Sigs are fire-and-forget.** Emitting a Sig is non-blocking. If no consumer is listening, the Sig is discarded. Sigs never block the pipeline.
- **Rollback must be total.** A partial rollback (some modules rolled back, others not) is a conformance failure.
- **The watcher is the sole trigger.** No internal mechanism, timer, or heuristic may trigger a Reload. Only file-change events from the watcher trigger Reloads.

### 13.3 To Future Implementors

Any program that claims conformance with this specification must:

1. Implement all states in §5 and all transitions in §5.2.
2. Prohibit all transitions not listed in §5.2.
3. Implement SCC decomposition and ReloadSet computation as defined in §6–§7.
4. Emit all Sigs defined in this document at the defined points.
5. Implement supersession as defined in §9.
6. Classify all errors per §10.
7. Satisfy all invariants in §12 for every Reload.

---

## 14. Anti-Goals

The following are **explicitly not goals** of hot.js and will never be added:

| Anti-Goal | Reason |
|---|---|
| Lifecycle hooks | Nondeterminism vector. See §2. |
| Plugin system | Nondeterminism vector. Expands the attack surface for entropy. |
| State preservation across reloads | Requires opinion about state shape. Violates §12.8. |
| Bundler integration | hot.js operates below the bundler layer. |
| HMR protocol compatibility | HMR is a framework-level concern. hot.js is substrate-level. |
| Automatic retry on failure | Introduces hidden temporal coupling and state. |
| Conditional reload (filter/ignore patterns beyond config) | Adds decision points inside the pipeline. All filtering is in Config, read once. |
| User-defined evaluation order | Topological order is the only correct order. |

---

## 15. Versioning

### 15.1 Pre-Stability Notice

This specification uses **v0.x.y** versioning per Semantic Versioning 2.0.0. The `0.x` major version signals that no consumer contract is yet in effect. All sections are normative for the reference implementation, but the spec may change freely between minor versions until v1.0.0 is minted alongside a stable MVP.

### 15.2 Version Semantics (v0.x)

- **Minor (0.x.0):** Any change — additive, breaking, structural, doctrinal.
- **Patch (0.x.y):** Clarifications, typo fixes, and editorial changes with no behavioral impact.

### 15.3 Promotion to v1.0.0

v1.0.0 will be minted when:

1. A conformant implementation exists and passes its own test suite.
2. All three integration modes (§11) are implemented and exercised.
3. The spec has survived at least one full design-build-test cycle without structural revision.

At that point, standard SemVer rules apply (major = breaking, minor = additive, patch = editorial).

### 15.4 Changelog

| Version | Date | Description |
|---|---|---|
| 0.1.0 | 2026-04-22 | Initial specification under hookless substrate doctrine. SCC semantics, ReloadSet computation, supersession, error model, integration modes, and invariants fully specified. |

---

*End of specification.*
