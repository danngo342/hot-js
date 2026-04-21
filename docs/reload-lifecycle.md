# hot.js reload lifecycle v1.2.2

## 1. Purpose and scope

hot.js v1.2.2 defines a deterministic, implementation-tight reload lifecycle for JavaScript module graphs.

This document is normative for:

- Graph model: modules, dependencies, SCCs, lexical keys  
- Reload lifecycle: phases, ordering, observable effects  
- SCC lexical key: identity across reloads  
- `currentModule` mutability rules  
- Error-key namespace and classification  
- Cancellation classification  
- Immutability rules  

Anything not specified here is intentionally non-normative.

---

## 2. Core model

### 2.1 Entities

- **ModuleId:**  
  Opaque, stable identifier for a module source. Must be stable across reloads.

- **ModuleRecord:**  
  Contains:
  - `id: ModuleId`  
  - `dependencies: ModuleId[]`  
  - `evaluate(): Promise<void>`  
  - `exports: object`  
  - `meta: object`  

- **ModuleState:**  
  `"unloaded" | "instantiated" | "evaluating" | "evaluated" | "failed"`

- **ModuleInstance:**  
  - `record: ModuleRecord`  
  - `state: ModuleState`  
  - `exports: object`  
  - `version: integer`  

- **ReloadToken:**  
  Unique identifier for a reload. Immutable.

---

### 2.2 Graph and SCCs

- **Dependency graph:**  
  Directed graph `G = (V, E)` where `V = ModuleId[]` and `E = (a → b)` if `a` imports `b`.

- **SCC (Strongly Connected Component):**  
  Maximal subset where every node is reachable from every other.

- **SCCGraph:**  
  DAG of SCCs.

**Invariant:** SCCGraph is acyclic.

---

## 3. SCC lexical key

### 3.1 Purpose

Provides canonical identity for SCCs across reloads. Stable under module version changes.

### 3.2 Definition

```
SCCLexicalKey(S):
  1. M = sorted list of ModuleId in S.
  2. For each m in M:
       Dm = sorted list of direct dependencies of m.
       Append (m, Dm) to Sig.
  3. Serialize Sig deterministically.
  4. Return Hash(Sig).
```

**Requirements:**

- Deterministic  
- Stable under version changes  
- Collisions are fatal internal errors  

---

## 4. `currentModule` semantics

### 4.1 Definition

`currentModule` is task-local reference to the module currently being evaluated.

### 4.2 Lifecycle

- Before evaluation: `null`  
- During evaluation of module `M`:  
  - Set to `M` before user code  
  - Remains `M` through all top-level await segments  
- After evaluation: restored to previous value

### 4.3 Mutability rules

- Read-only to user code  
- Must remain consistent during evaluation  
- Nested evaluation must restore correctly

---

## 5. Reload lifecycle

### 5.1 Phases

1. Diff  
2. Plan  
3. Instantiate  
4. Evaluate  
5. Commit  
6. Notify (non-normative ordering)

### 5.2 Inputs/outputs

- Input: old graph, new module records  
- Output: success (new graph) or failure (ReloadError)

---

## 6. Normative reload algorithm

### 6.1 Diff and SCC computation

```
reload(reloadToken, changedModuleRecords):
  1. G_old = current graph.
  2. Apply changedModuleRecords → G_new.
  3. Compute SCC_old, SCC_new.
  4. Compute key_new[S] for each S in SCC_new.
  5. Compute key_old[T] for each T in SCC_old.
  6. Map old SCCs to new SCCs by matching keys.
       - Collision → InternalError.
       - No match → retired.
  7. Mark SCCs as reused or new.
```

### 6.2 Reload plan

```
  8. DAG_new = SCCGraph(G_new).
  9. Order = topological order of DAG_new.
 10. For each S in Order:
       If reused and deps unchanged → skip
       Else → reload
```

**Invariant:** Dependencies appear before dependents.

### 6.3 Instantiation and evaluation

```
 12. For each (S, action) in Plan:
       If skip: continue
       If reload:
         Instantiate all modules in S
         evaluateSCC(S, reloadToken)
```

#### 6.3.1 SCC evaluation

```
evaluateSCC(S, reloadToken):
  1. modules = sorted ModuleId list.
  2. For each m in modules:
       inst = new instance
       inst.state = "evaluating"
       currentModule = inst
       Try:
         await inst.record.evaluate()
         inst.state = "evaluated"
       Catch e:
         inst.state = "failed"
         throw classifyReloadError(e, reloadToken, m, S)
       Restore previous currentModule
```

**Invariants:**

- Each instance evaluated once  
- SCC atomicity: all-or-nothing  

### 6.4 Commit semantics

Two allowed strategies:

- **Transactional:** no partial commit  
- **Incremental:** earlier SCCs may commit

**Invariant:** No partial SCC commit.

---

## 7. Error-key namespace and classification

### 7.1 Namespace

```
hot.reload.<category>.<reason>
```

Categories:

- `internal`  
- `user`  
- `graph`  
- `cancel`  
- `divergence`  

### 7.2 ReloadError shape

- `key`  
- `reloadToken`  
- `moduleId?`  
- `sccKey?`  
- `cause?`  

### 7.3 Classification

```
classifyReloadError(e, reloadToken, moduleId, scc):
  If explicit cancellation → hot.reload.cancel.explicit
  If timeout → hot.reload.cancel.timeout
  If user error → hot.reload.user.module-evaluation-error
  If SCC key collision → hot.reload.graph.scc-key-collision
  Else → hot.reload.internal.unexpected-state
```

### 7.4 Internal errors

SCC key collisions are fatal.

---

## 8. Cancellation and divergence

### 8.1 Categories

- Cancellation  
- Failure  
- Divergence  

### 8.2 Rules

- Cancellation → `hot.reload.cancel.*`  
- User failures → `hot.reload.user.*`  
- Graph issues → `hot.reload.graph.*`  
- Internal → `hot.reload.internal.*`  
- Divergence → `hot.reload.divergence.*`

**Invariant:** Exactly one category per reload.

---

## 9. Immutability rules

### 9.1 Exports

- Exports object identity stable per instance  
- Live binding semantics preserved  
- After commit, mapping from ModuleId → ModuleInstance is immutable until next reload

### 9.2 Graph structure

Graph immutable between reloads except for explicitly out-of-scope dynamic loading.

### 9.3 ReloadToken

Immutable and unique.

---

## 10. Contracts and guarantees

### 10.1 Determinism

Given same inputs and implementation:

- Same reload plan  
- Same error classification  
- Same observable behavior  

### 10.2 Isolation

- Failed reload cannot corrupt previous graph  
- `currentModule` always restored

### 10.3 Observability

Hooks allowed but must not mutate lifecycle invariants.

---

## 11. Versioning notes for v1.2.2

- SCC lexical key pinned  
- `currentModule` clarified  
- Normative reload algorithm defined  
- Error-key namespace formalized  
- Cancellation/failure/divergence classification tightened  
- Immutability rules strengthened
