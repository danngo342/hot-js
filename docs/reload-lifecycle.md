# Reload Lifecycle Specification — v1.4.0

This document defines the normative reload lifecycle for the hot.js runtime.  
Terminology used here is defined in **glossary v1.0.0**.  
This document specifies **behavior**, not definitions.

---

# 1. Overview

A reload consists of five phases:

1. **Plan** — compute reloadSCCs and the SCCGraph  
2. **Instantiate** — create provisional ModuleInstances  
3. **Prepare** — build the evaluation plan  
4. **Evaluate** — evaluate SCCs in deterministic order  
5. **Commit** — publish evaluated SCCs atomically  

Reload behavior is defined at the SCC level.  
No partial SCC commit is permitted.

---

# 2. Inputs and Outputs

## 2.1 Inputs

- `G_prev`: the previous committed module graph  
- updated ModuleRecords  
- reloadToken: unique identifier for this reload attempt  

## 2.2 Outputs

- updated committed graph (if commit occurs)  
- thrown ReloadError (if evaluation or commit fails)  

---

# 3. Phase 1 — Plan

The runtime computes:

1. **G_new** — the new dependency graph derived from updated ModuleRecords  
2. **SCCs(G_new)** — strongly connected components  
3. **SCCGraph** — DAG of SCCs  
4. **reloadSCCs** — SCCs requiring reload  
   - Determined by structural changes, ModuleRecord changes, or dependency changes  

**Invariant:**  
All modules in reloadSCCs MUST be reloaded.  
No module outside reloadSCCs MAY be reloaded.

---

# 4. Phase 2 — Instantiate

For each module in `reloadModules` (the union of modules in reloadSCCs):

- create a **provisional ModuleInstance**  
- set:
  - `moduleId = record.id`
  - `record = ModuleRecord`
  - `version = previous.version + 1` (or new token)
  - `state = "instantiated"`

Instances created here are **not yet committed**.

---

# 5. Phase 3 — Prepare

The runtime constructs the **evaluation plan**:

1. Topologically sort the SCCGraph using **deterministic topological order**  
2. Filter to SCCs in reloadSCCs  
3. Produce a deterministic list of SCCs to evaluate  

This ensures:

- deterministic evaluation order  
- deterministic commit order (for incremental commit)  

---

# 6. Phase 4 — Evaluate

Evaluation proceeds SCC‑by‑SCC in the order defined by the evaluation plan.

## 6.1 SCC Atomicity (Evaluation Perspective)

- Evaluation may produce intermediate ModuleInstance states  
- These states are **not externally visible**  
- Only commit makes results visible  

## 6.2 `evaluateSCC` Algorithm

Given:

- `S`: an SCC  
- `modules(S)`: modules in deterministic lexical order  
- `instances`: map `ModuleId → ModuleInstance`  
- `reloadToken`: reload identifier  

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
      const err = classifyReloadError(e, reloadToken, inst.moduleId, S);
      throw err;
    } finally {
      currentModule = prev;
    }
  }
}
```

## 6.3 Evaluation Invariants

- `currentModule` MUST always be restored (even if classifyReloadError throws)  
- If any module in `S` fails:
  - `evaluateSCC` MUST throw a ReloadError  
  - `S` MUST NOT be committed  
- If all modules in `S` evaluate successfully:
  - `S` becomes eligible for commit  

---

# 7. Phase 5 — Commit

Commit publishes evaluated SCCs to the live graph.

## 7.1 SCC Atomicity (Commit Perspective)

**No partial SCC commit is permitted.**

An SCC `S` commits only if:

- all ModuleInstances in `S` have `state = "evaluated"`  

If any ModuleInstance in `S` has `state = "failed"`:

- `S` MUST NOT commit  
- previous instances remain active  

## 7.2 Commit Strategies

### Strategy A — All‑at‑once Commit

- All SCCs must evaluate successfully  
- Only then commit the entire new graph  
- If any SCC fails:
  - no SCC commits  
  - `G_prev` remains active  

### Strategy B — Incremental SCC Commit

- SCCs commit individually in deterministic topological order  
- After `evaluateSCC(S)` succeeds:
  - commit `S` immediately  
- If a later SCC fails:
  - earlier committed SCCs remain committed  
  - reload fails for remaining SCCs  

**Invariant:**  
Even under incremental commit, **no SCC is partially committed**.

---

# 8. Error Handling

## 8.1 Error Classification

Errors are classified into canonical categories:

- `"internal"`  
- `"user"`  
- `"graph"`  
- `"cancel"`  
- `"divergence"`  

Classification is performed by `classifyReloadError`.

## 8.2 `classifyReloadError` Behavior

- Maps raw errors to ReloadError  
- Attaches:
  - `reloadToken`  
  - `moduleId`  
  - `sccKey` (derived from SCC.lexicalKey)  
- Ensures consistent error taxonomy  

## 8.3 Error Propagation

- Any error during evaluation aborts the current SCC  
- Commit behavior depends on commit strategy  
- Divergence errors may require full restart  

---

# 9. Invariants

The following invariants MUST hold:

### 9.1 Dynamic Context Invariant
`currentModule` MUST always be restored to its previous value.

### 9.2 SCC Atomicity Invariant
No partial SCC commit is permitted.

### 9.3 Graph Invariants
- SCCGraph MUST be a DAG  
- lexical keys MUST be stable under version changes  
- SCC key collisions MUST be treated as fatal  

### 9.4 Reload Set Invariant
reloadSCCs MUST determine exactly which modules are instantiated and evaluated.

---

# 10. Previous Graph and Divergence

## 10.1 Previous Graph (`G_prev`)
The last fully committed graph before reload began.

## 10.2 Divergence Detection

During reload:

- committed SCCs update the **current graph**  
- `G_prev` remains the reference for invariants  
- divergence occurs when:
  - the current graph violates invariants derived from `G_prev` or intended `G_new`  

Divergence MUST raise a `"divergence"` ReloadError.

---

# 11. Document Structure and Numbering

- This document uses section numbers, not “steps”  
- Phase ordering is normative  
- Section numbering is descriptive  
- No guarantee is made about contiguous numbering across versions  

---

# 12. Versioning

This document is versioned independently.

- **v1.4.0** — glossary‑aligned, invariant‑aligned, corrected dynamic context restoration, corrected reload set semantics, deterministic topo order clarified  
- Minor versions indicate semantic changes  
- Patch versions indicate editorial changes  

