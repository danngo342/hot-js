# Reload Lifecycle Specification — v1.4.1

This document defines the normative reload lifecycle for the hot.js runtime.  
Terminology is defined in **glossary v1.0.0**.  
Invariants are defined in **invariants v1.0.0**.  
Error semantics are defined in **error-model v1.0.0**.

This document specifies **behavior**, not definitions.

---

# 1. Overview

A reload consists of five phases:

1. **Plan** — compute the Reload Set (reloadSCCs)  
2. **Instantiate** — create provisional ModuleInstances for Reload Modules  
3. **Prepare** — compute deterministic evaluation order  
4. **Evaluate** — evaluate SCCs in deterministic order  
5. **Commit** — publish evaluated SCCs atomically  

Reload behavior is defined at the SCC level.  
No partial SCC commit is permitted.

---

# 2. Terminology Alignment

This document uses identifiers aligned with glossary terms:

- **Reload Set** → `reloadSCCs` (set of SCCs requiring reload)  
- **Reload Modules** → `reloadModules` (union of modules in reloadSCCs)  

These identifiers correspond exactly to glossary definitions.

---

# 3. Phase 1 — Plan

The runtime computes:

1. **G_new** — dependency graph from updated ModuleRecords  
2. **SCCs(G_new)** — strongly connected components  
3. **SCCGraph** — DAG of SCCs  
4. **reloadSCCs** — the Reload Set  

**Reload Scope Invariant:**  
All modules in **Reload Modules** MUST be reloaded.  
No module outside **Reload Modules** MAY be reloaded.

---

# 4. Phase 2 — Instantiate

For each module in **Reload Modules**:

- create a **provisional ModuleInstance**  
- set:
  - `moduleId = record.id`
  - `record = ModuleRecord`
  - `version = previousInstance.version + 1`  
    where `previousInstance` is the committed instance from `G_prev`
  - `state = "instantiated"`

Instances created here are **not yet committed**.

---

# 5. Phase 3 — Prepare

The runtime constructs the **evaluation plan**:

1. Topologically sort the SCCGraph using **deterministic topological order**  
2. Filter to SCCs in reloadSCCs  
3. Produce a deterministic list of SCCs to evaluate  

This ensures reproducible evaluation and commit behavior.

---

# 6. Phase 4 — Evaluate

Evaluation proceeds SCC‑by‑SCC in deterministic order.

## 6.1 SCC Atomicity (Evaluation)

- Intermediate ModuleInstance states MUST NOT be externally visible  
- Only commit makes results visible  

(Visibility invariant defined in invariants v1.0.0.)

---

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
      // Missing-instance is an internal error; must surface as ReloadError
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

---

## 6.3 Evaluation Rules

- If any module in `S` fails, `evaluateSCC` MUST throw a `ReloadError`  
- Missing-instance MUST classify as an `"internal"` ReloadError  
- `currentModule` MUST always be restored (dynamic context invariant)  
- If all modules in `S` evaluate successfully, `S` becomes eligible for commit  

---

# 7. Phase 5 — Commit

Commit publishes evaluated SCCs to the live graph.

## 7.1 SCC Atomicity (Commit)

An SCC `S` MAY commit only if:

- all ModuleInstances in `S` have `state = "evaluated"`

If any ModuleInstance in `S` has `state = "failed"`:

- `S` MUST NOT commit  
- previous committed instances remain active  

No partial SCC commit is permitted.

---

## 7.2 Commit Strategies

### Strategy A — All‑at‑once Commit

- All SCCs in reloadSCCs must evaluate successfully  
- Only then commit the **entire new graph**, defined as:
  - all provisional instances for Reload Modules  
  - plus all unchanged instances from `G_prev`  
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

---

# 8. Error Handling

## 8.1 Error Classification

All errors MUST be classified into exactly one category:

- `"internal"`  
- `"user"`  
- `"graph"`  
- `"cancel"`  
- `"divergence"`

Classification rules are defined in error-model v1.0.0.

---

## 8.2 Error Propagation

- Any error during evaluation aborts the current SCC  
- Commit behavior depends on commit strategy  
- Divergence MUST raise a `"divergence"` ReloadError  

---

# 9. Invariants (Referenced)

This document relies on invariants defined in invariants v1.0.0, including:

- Dynamic context invariants  
- SCC atomicity invariants  
- Visibility invariant  
- Graph invariants  
- Reload scope invariant  
- Divergence invariants  
- Determinism invariants  

These invariants are normative and MUST be enforced.

---

# 10. Previous Graph and Divergence

## 10.1 Previous Graph (`G_prev`)

The last fully committed graph before reload began.

## 10.2 Divergence Detection

Divergence occurs when the current graph violates invariants derived from:

- `G_prev`, or  
- the intended `G_new`

Examples include:

- SCCGraph no longer a DAG  
- lexical key collisions  
- partial commit states not reachable by valid SCC commit sequences  

Divergence MUST raise a `"divergence"` ReloadError.

---

# 11. Document Structure

- Section numbers are descriptive, not normative  
- Phase ordering is normative  
- No guarantee is made about contiguous numbering across versions  

---

# 12. Versioning

- **v1.4.1** — aligned with glossary v1.0.0, invariants v1.0.0, error-model v1.0.0; fixed terminology drift; fixed missing-instance contradiction; clarified commit semantics; clarified versioning; clarified Reload Set vs Reload Modules  
- Minor versions indicate semantic changes  
- Patch versions indicate editorial changes  

