# Error Model — v1.0.0

This document defines the **canonical error taxonomy**, **error shapes**, and **classification rules** for the hot.js reload system.  
Terminology is defined in glossary v1.0.0.  
Invariants are defined in invariants v1.0.0.

This file defines **how errors must be represented and classified** across all phases of reload.

---

# 1. ReloadError

All errors surfaced by the reload system MUST be represented as a `ReloadError`.

A `ReloadError` has the following fields:

- `name: string`  
- `category: ReloadErrorCategory`  
- `reloadToken: string`  
- `moduleId?: ModuleId`  
- `sccKey?: string`  
- `cause?: unknown`  

`ReloadError` MUST be a stable, serializable error type.

---

# 2. Error Categories

A `ReloadError` MUST belong to **exactly one** of the following categories:

### `"internal"`
Errors caused by the runtime itself, including:

- invariant violations  
- missing instances  
- unexpected states  
- lexical key collisions  
- SCCGraph corruption  
- impossible control-flow paths  

### `"user"`
Errors thrown by user module code during evaluation.

Examples:

- thrown exceptions  
- rejected promises  
- type errors inside module code  

### `"graph"`
Errors caused by structural issues in the dependency graph.

Examples:

- cycles not contained within SCCs  
- invalid dependency references  
- malformed ModuleRecords  

### `"cancel"`
Errors caused by explicit cancellation of the reload process.

Examples:

- user cancellation  
- timeout cancellation  
- external abort signals  

### `"divergence"`
Errors caused by the graph entering a state inconsistent with:

- invariants derived from `G_prev`, or  
- the intended `G_new`.

Examples:

- partial commit states not reachable by valid SCC commit sequences  
- graph corruption detected after commit  
- mismatch between expected and actual SCCGraph structure  

---

# 3. internalError

The runtime MAY generate an `internalError` when encountering an unexpected or invalid internal condition.

**Invariant:**  
Every `internalError` MUST be converted into a `ReloadError` with:

- `category = "internal"`  
- a stable `name` describing the condition  
- attached `reloadToken`  
- attached `moduleId` and `sccKey` when applicable  

### 3.1 Example: missing-instance

If the runtime attempts to evaluate a module whose provisional instance does not exist:

```ts
internalError("missing-instance", {
  moduleId: m,
  sccKey: S.lexicalKey
});
```

This MUST surface as:

```ts
ReloadError {
  name: "missing-instance",
  category: "internal",
  reloadToken,
  moduleId: m,
  sccKey: S.lexicalKey
}
```

This ensures consistency with §6.3 of the lifecycle spec, which requires that **any failure in an SCC evaluation MUST throw a ReloadError**.

---

# 4. classifyReloadError

`classifyReloadError` is the canonical function that maps raw errors to `ReloadError`.

Given:

- `rawError: unknown`  
- `reloadToken: string`  
- `moduleId?: ModuleId`  
- `scc?: SCC`  

It MUST:

1. Determine the category using the rules in §5.  
2. Produce a `ReloadError` with:
   - `name` derived from the raw error  
   - `category`  
   - `reloadToken`  
   - `moduleId` (if provided)  
   - `sccKey = scc.lexicalKey` (if provided)  
   - `cause = rawError`  

No raw error MAY escape classification.

---

# 5. Classification Rules

Classification MUST follow this order:

### 5.1 Cancellation
If the raw error represents an explicit cancellation signal:

- category = `"cancel"`

### 5.2 Divergence
If the runtime detects a violation of divergence invariants:

- category = `"divergence"`

### 5.3 Internal
If the raw error is an `internalError` or indicates an invariant violation:

- category = `"internal"`

### 5.4 Graph
If the raw error indicates a structural graph issue:

- category = `"graph"`

### 5.5 User
All other errors thrown by module evaluation:

- category = `"user"`

This ordering ensures deterministic classification.

---

# 6. Error Propagation

### 6.1 Evaluation
If any module in an SCC fails:

- `evaluateSCC` MUST throw a `ReloadError`.

### 6.2 Commit
Commit behavior depends on commit strategy, but:

- no SCC MAY commit after a `ReloadError` in that SCC  
- previously committed SCCs (in incremental mode) remain committed  

### 6.3 Divergence
If divergence is detected at any point:

- reload MUST abort  
- a `ReloadError` with `category = "divergence"` MUST be thrown  

---

# 7. Versioning

- **v1.0.0** — initial stable error model  
- Minor versions indicate semantic changes  
- Patch versions indicate editorial changes  

