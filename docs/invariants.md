# Invariants — v1.0.0

This document lists **normative invariants** for the hot.js runtime.  
Glossary defines terminology; lifecycle defines behavior.  
This file defines the **rules that must always hold**.

---

# 1. Dynamic context invariants

### 1.1 currentModule restoration

**Invariant:**  
For any evaluation of a ModuleInstance:

- **Before** evaluation starts, `currentModule` MUST be set to that ModuleInstance.
- **After** evaluation completes or fails, `currentModule` MUST be restored to its previous value.

Corollaries:

- `currentModule` MUST NOT remain bound to a ModuleInstance after its evaluation has finished.
- Restoration MUST occur even if classification or error wrapping throws.

---

### 1.2 currentModule async-boundary invariant

**Invariant:**  
`currentModule` MUST NOT leak across asynchronous boundaries in a way that misattributes work.

More precisely:

- If evaluation of a ModuleInstance suspends on an `await`, any resumed work attributed to that evaluation MUST still see `currentModule` as that ModuleInstance.
- No other concurrent evaluation or unrelated async work MAY observe `currentModule` as that ModuleInstance.

This ensures:

- correct error attribution  
- correct hook attribution  
- correct cancellation scoping  

---

# 2. SCC and commit invariants

### 2.1 SCC atomicity (commit)

**Invariant:**  
No SCC MAY be partially committed.

For any SCC `S`:

- If any ModuleInstance in `S` has `state = "failed"`, then **no** ModuleInstance in `S` MAY be committed.
- An SCC `S` MAY commit **only if** all ModuleInstances in `S` have `state = "evaluated"`.

---

### 2.2 SCC atomicity (visibility)

**Invariant:**  
Intermediate evaluation states of ModuleInstances in an SCC MUST NOT be externally visible until commit.

Implications:

- Provisional ModuleInstances MUST NOT be observable by user code or external consumers before commit.
- Observers MUST see either:
  - the previous committed instances (from `G_prev`), or  
  - the newly committed instances, never a mix within a single SCC.

---

# 3. Graph invariants

### 3.1 SCCGraph acyclicity

**Invariant:**  
The SCCGraph MUST be a DAG.

- No cycles MAY exist between SCCs.
- Any cycle in the underlying module graph MUST be contained entirely within a single SCC.

---

### 3.2 Lexical key stability

**Invariant:**  
An SCC’s lexical key MUST be:

- stable under changes to ModuleInstance versions, and  
- changed whenever the SCC’s structure changes (membership or internal edges).

Corollary:

- If two structurally distinct SCCs produce the same lexical key, this MUST be treated as a fatal graph error.

---

# 4. Reload scope invariants

### 4.1 Reload set and reload modules

Let:

- **Reload Set** = set of SCCs requiring reload (reloadSCCs)  
- **Reload Modules** = union of all modules in Reload Set (reloadModules)

**Invariant:**

- All modules in **Reload Modules** MUST be instantiated and evaluated during reload.
- No module outside **Reload Modules** MAY be instantiated or evaluated as part of that reload.

This ties:

- planning (Reload Set)  
- instantiation (Reload Modules)  
- evaluation (SCCs in Reload Set)  

into a single coherent scope.

---

# 5. Error and divergence invariants

### 5.1 Error classification invariant

**Invariant:**  
Any error arising during reload MUST be classified into exactly one of:

- `"internal"`  
- `"user"`  
- `"graph"`  
- `"cancel"`  
- `"divergence"`

No error MAY be left unclassified or ambiguously classified.

---

### 5.2 internalError invariant

**Invariant:**  
Any `internalError` produced by the runtime MUST surface as a `ReloadError` with:

- `category = "internal"`  
- a stable, documented `name`  
- attached `reloadToken` and, when applicable, `moduleId` and `sccKey`.

---

### 5.3 Divergence invariant

**Invariant:**  
If the current graph violates invariants derived from `G_prev` or the intended `G_new`, the runtime MUST treat this as divergence and raise a `ReloadError` with:

- `category = "divergence"`.

Examples of divergence (non-exhaustive):

- committed graph no longer forms a valid SCCGraph DAG  
- lexical key collisions not detected earlier  
- partial application of a commit strategy that leaves the graph in a state not reachable by any valid sequence of SCC commits

---

# 6. Determinism invariants

### 6.1 Deterministic evaluation order

**Invariant:**  
Given the same inputs (`G_prev`, updated ModuleRecords, reloadToken), the runtime MUST:

- compute the same Reload Set,  
- compute the same SCCGraph, and  
- produce the same deterministic topological order of SCCs and modules within each SCC.

This ensures:

- reproducible evaluation  
- reproducible commit behavior  
- stable error attribution  

