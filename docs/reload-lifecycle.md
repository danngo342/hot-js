# Reload Lifecycle Specification 1.3.0-rc1

This document defines the normative reload lifecycle for the hot.js runtime: how module graphs are reloaded, evaluated, and committed with deterministic behavior and SCC‑level atomicity.

---

# 1. Core Runtime Types

## 1.1 ModuleId
Opaque, unique identifier for a module within a graph.

## 1.2 ModuleRecord
Static description of a module.

- **id:** `ModuleId`
- **dependencies:** `ModuleId[]`
- **evaluate:** `() => Promise<void> | void`  
  Top‑level evaluation function.

## 1.3 ModuleInstance
Runtime instance of a ModuleRecord for a given reload.

- **moduleId:** `ModuleId`
- **record:** `ModuleRecord`
- **version:** monotonic integer or token
- **state:** `ModuleState`

## 1.4 ModuleState
Lifecycle state of a ModuleInstance.

- `"unloaded"` — no instance exists yet
- `"instantiated"` — instance created, evaluation not started
- `"evaluating"` — evaluation in progress
- `"evaluated"` — evaluation completed successfully
- `"failed"` — evaluation threw or rejected

**Normative transitions:**

```
unloaded → instantiated → evaluating → (evaluated | failed)
```

---

# 2. SCCs and Lexical Keys

## 2.1 Strongly Connected Components (SCCs)
Given the module dependency graph:

- Nodes: `ModuleId`
- Edges: `A → B` if A depends on B

An SCC is a maximal set of modules mutually reachable.  
Each SCC is an **atomic reload unit**.

## 2.2 SCCGraph
DAG formed by collapsing each SCC into a single node.

- Nodes: SCCs
- Edges: `S1 → S2` if any module in S1 depends on any module in S2

This graph is acyclic and topologically sortable.

## 2.3 Lexical Key
Each SCC `S` has a **lexical key**:

- Deterministic hash of a canonical serialization of:
  - module membership
  - internal edges
- **Stable under version changes:**  
  Depends only on graph structure, not ModuleInstance.version.
- **Changes when structure changes.**
- **Hash collisions:**  
  Theoretically possible; treated as fatal graph errors.

---

# 3. Dynamic Evaluation Context

## 3.1 `currentModule`
A dynamic evaluation context:

- **Type:** `ModuleInstance | null`
- **Meaning:** the ModuleInstance whose `evaluate()` is currently executing
- **Scope:** runtime context, not user code

## 3.2 Invariant
At all times:

- If non‑null, `currentModule` **must** be the ModuleInstance currently being evaluated.
- It is set before evaluation and restored afterward, even on error.

## 3.3 Dynamic Context Pattern

```ts
const prev = currentModule;
currentModule = inst;
try {
  // evaluation
} finally {
  currentModule = prev;
}
```

Ensures correct:

- error attribution  
- cancellation scoping  
- hook attribution  
- async resume attribution  
- nested evaluation semantics  

---

# 4. Reload Phases

## 4.1 Phase List

1. **Plan** — compute reload set and SCCGraph  
2. **Instantiate** — create ModuleInstances  
3. **Prepare** — build evaluation plan  
4. **Evaluate** — evaluate SCCs  
5. **Commit** — publish new instances

## 4.2 Phase ↔ Section Mapping

- Phases 1–3 → §5  
- Phase 4 → §6.3  
- Phase 5 → §6.4  

---

# 5. Phases 1–3: Plan, Instantiate, Prepare

## 5.1 Phase 1: Plan

Given:

- previous committed graph `G_prev`
- new module records

Compute:

- new graph `G_new`
- SCCs of `G_new`
- SCCGraph (DAG)
- **reload set** = SCCs requiring reload

## 5.2 Phase 2: Instantiate

For each module in the reload set:

- create new ModuleInstance:
  - `state = "instantiated"`

Instances are **provisional** until commit.

## 5.3 Phase 3: Prepare

- Topologically sort SCCGraph
- Build ordered list of SCCs in reload set  
  (this is the **evaluation plan**)

---

# 6. Phases 4–5: Evaluate and Commit

# 6.1 Overview
Phase 4 evaluates SCCs.  
Phase 5 commits successfully evaluated SCCs.

# 6.2 SCC Atomicity

**Definition:**  
**No partial SCC commit.**  
Either all modules in an SCC commit, or none do.

Intermediate ModuleInstance states during evaluation are **not externally visible** if the SCC fails.

---

# 6.3 Phase 4: `evaluateSCC`

## 6.3.1 Algorithm

Given:

- `S`: SCC
- `modules(S)`: modules in deterministic lexical order
- `instances`: map `ModuleId → ModuleInstance`
- `reloadToken`: unique token for this reload

```ts
async function evaluateSCC(S, instances, reloadToken) {
  for (const m of modules(S)) {
    const inst = instances.get(m);
    if (!inst) {
      throw internalError("missing-instance", {
        moduleId: m,
        sccKey: S.lexicalKey
      });
    }

    inst.state = "evaluating";

    const prev = currentModule;
    currentModule = inst;

    try {
      await inst.record.evaluate();
      inst.state = "evaluated";
    } catch (e) {
      inst.state = "failed";

      const err = classifyReloadError(
        e,
        reloadToken,
        inst.moduleId,
        S // SCC object
      );

      currentModule = prev;
      throw err;
    }

    currentModule = prev;
  }
}
```

## 6.3.2 Invariants

- `currentModule` is always restored
- If any module fails:
  - `evaluateSCC` throws a ReloadError
  - SCC is **not** committed
- If all succeed:
  - SCC is eligible for commit

---

# 6.4 Phase 5: Commit

## 6.4.1 No Partial SCC Commit

An SCC `S` commits **only if** all modules in `S` have `state = "evaluated"`.

If any module failed:

- `S` is not committed  
- previous instances remain active

## 6.4.2 Commit Strategies

### Strategy A: All‑at‑once

- All SCCs must evaluate successfully
- Then commit entire graph
- If any SCC fails:
  - no SCC commits

### Strategy B: Incremental SCC Commit

- SCCs evaluated in topo order
- After `evaluateSCC(S)` succeeds:
  - commit `S` immediately
- If later SCC fails:
  - earlier committed SCCs remain committed
  - reload fails for remaining SCCs

**Invariant:**  
Even with incremental commit, **no SCC is partially committed**.

## 6.4.3 Binding

- Phase 4 = §6.3  
- Phase 5 = §6.4  

---

# 7. Errors and Classification

## 7.1 Error Categories

Top‑level categories:

- `"internal"`
- `"user"`
- `"graph"`
- `"cancel"`
- `"divergence"`

Names follow:

- `hot.reload.internal.*`
- `hot.reload.user.*`
- `hot.reload.graph.*`
- `hot.reload.cancel.*`
- `hot.reload.divergence.*`

## 7.2 ReloadError Shape

- **name:** string
- **category:** one of the five categories
- **reloadToken:** token for this reload
- **moduleId?:** ModuleId
- **sccKey?:** lexical key (`S.lexicalKey`)
- **cause?:** original error

## 7.3 `classifyReloadError`

```ts
function classifyReloadError(e, reloadToken, moduleId, scc) {
  const sccKey = scc ? scc.lexicalKey : undefined;

  if (isCancellationError(e)) {
    return new ReloadError({
      name: "hot.reload.cancel.requested",
      category: "cancel",
      reloadToken,
      moduleId,
      sccKey,
      cause: e
    });
  }

  if (isSccKeyCollisionError(e)) {
    return new ReloadError({
      name: "hot.reload.graph.scc-key-collision",
      category: "graph",
      reloadToken,
      moduleId,
      sccKey,
      cause: e
    });
  }

  if (isGraphDivergenceError(e)) {
    return new ReloadError({
      name: "hot.reload.divergence.graph-corruption",
      category: "divergence",
      reloadToken,
      moduleId,
      sccKey,
      cause: e
    });
  }

  if (isUserError(e)) {
    return new ReloadError({
      name: "hot.reload.user.module-evaluation-error",
      category: "user",
      reloadToken,
      moduleId,
      sccKey,
      cause: e
    });
  }

  return new ReloadError({
    name: "hot.reload.internal.unexpected-state",
    category: "internal",
    reloadToken,
    moduleId,
    sccKey,
    cause: e
  });
}
```

## 7.4 Definition: User Error

A **user error** is:

- any error thrown or rejection produced by user module code during evaluation,
- that is not cancellation, graph error, divergence, or internal runtime error.

---

# 8. Cancellation and Divergence

## 8.1 Categories

- **Cancellation** — explicit cancellation
- **Failure** — user or graph errors
- **Divergence** — corrupted or inconsistent graph
- **Internal** — runtime bugs

## 8.2 Mapping

- User failures → `"user"`
- Graph failures → `"graph"`
- Cancellation → `"cancel"`
- Divergence → `"divergence"`
- Runtime bugs → `"internal"`

---

# 9. Invariants

## 9.1 `currentModule`
- always null or the ModuleInstance currently evaluating
- always restored after evaluation
- dynamic context, not user-visible

## 9.2 SCC Atomicity
- no partial SCC commit
- intermediate states not externally visible if SCC fails

## 9.3 Graph Invariants
- SCCGraph is always a DAG
- lexical keys stable under version changes
- SCC key collisions are fatal

---

# 10. Previous Graph and Corruption

## 10.1 Previous Graph (`G_prev`)
The last fully committed graph **before** the reload began.

Used for:

- divergence detection
- corruption checks
- rollback semantics

## 10.2 Incremental Commit and Previous Graph

With incremental commit:

- committed SCCs update the **current graph**
- `G_prev` remains the pre‑reload snapshot
- divergence checks compare:
  - current graph (after partial commits)
  - invariants derived from `G_prev` and intended `G_new`

If corruption detected:

- raise divergence error
- runtime may require full restart or recovery

---

# 11. Step Numbering

All steps in §5–§6 are contiguous and aligned with the phase list.  
Any previous gaps (e.g., missing step 11) are removed.

