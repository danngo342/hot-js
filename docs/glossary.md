# Glossary — v1.0.0

This glossary defines all terminology used across the hot.js specification suite.  
Definitions here are **normative** unless explicitly marked otherwise.

---

# 1. Module Concepts

### **ModuleId**
Opaque, unique identifier for a module within a graph.  
Stable across reloads unless the module is removed.

### **ModuleRecord**
Static description of a module.

Fields:
- `id: ModuleId`
- `dependencies: ModuleId[]`
- `evaluate(): Promise<void> | void`

### **ModuleInstance**
Runtime instance of a ModuleRecord for a given reload.

Fields:
- `moduleId: ModuleId`
- `record: ModuleRecord`
- `version: integer | token`
- `state: ModuleState`

### **ModuleState**
Lifecycle state of a ModuleInstance.

- `"unloaded"` — no instance exists yet  
- `"instantiated"` — instance created, evaluation not started  
- `"evaluating"` — evaluation in progress  
- `"evaluated"` — evaluation completed successfully  
- `"failed"` — evaluation threw or rejected  

---

# 2. Graph Concepts

### **Dependency Graph**
Directed graph where:
- nodes = ModuleId  
- edges = `A → B` if A depends on B  

### **Strongly Connected Component (SCC)**
Maximal set of modules where each module is reachable from every other.  
SCCs are **atomic reload units**.

### **SCCGraph**
DAG formed by collapsing each SCC into a single node.

### **Lexical Key**
Deterministic hash of a canonical serialization of:
- SCC membership  
- internal edges  

Properties:
- **Stable under version changes**  
- **Changes when structure changes**  
- **Collisions are fatal graph errors**

### **Previous Graph (`G_prev`)**
The last fully committed graph **before** the current reload began.  
Used for divergence detection and corruption checks.

---

# 3. Reload Concepts

### **Reload Set**
The set of SCCs that must be reloaded due to changes.

### **Reload Modules**
Union of all modules contained in the reload set’s SCCs.

### **Provisional Instance**
A ModuleInstance created during reload but not yet committed.

### **Commit**
The act of publishing new ModuleInstances to the live graph.  
Commit is **SCC‑atomic**: no partial SCC commit is allowed.

### **Incremental Commit**
Commit strategy where SCCs may commit individually in topological order.

### **All‑at‑once Commit**
Commit strategy where all SCCs must succeed before any commit occurs.

---

# 4. Evaluation Concepts

### **Dynamic Evaluation Context**
Runtime context that tracks which module is currently being evaluated.

### **currentModule**
Dynamic variable of type `ModuleInstance | null`.

Meaning:
- The ModuleInstance whose `evaluate()` is currently executing.

Rules:
- Set before evaluation  
- Restored after evaluation  
- Must be restored even on error  
- Must not leak across async boundaries  

### **Deterministic Topological Order**
A topological sort where ties are broken by lexical key ordering.  
Ensures deterministic evaluation order.

---

# 5. Error Concepts

### **ReloadError**
Canonical error type thrown during reload.

Fields:
- `name`
- `category`
- `reloadToken`
- `moduleId?`
- `sccKey?`
- `cause?`

### **Error Categories**
Canonical top‑level categories:

- `"internal"` — runtime bugs or invariant violations  
- `"user"` — errors thrown by user module code  
- `"graph"` — structural graph errors (e.g., SCC key collision)  
- `"cancel"` — explicit cancellation  
- `"divergence"` — corrupted or inconsistent graph state  

### **User Error**
Any error originating from user module code that is not:
- cancellation  
- graph error  
- divergence  
- internal runtime error  

### **Graph Divergence**
A state where the current graph violates invariants derived from `G_prev` or the intended `G_new`.

---

# 6. Invariants (Referenced Only)
Full definitions live in `invariants.md`, but referenced terms include:

- **SCC Atomicity** — no partial SCC commit  
- **Graph DAG Invariant** — SCCGraph must be acyclic  
- **Lexical Key Stability** — stable under version changes  
- **currentModule Restoration** — must always restore previous value  

---

# 7. Versioning

This glossary is versioned independently from other spec documents.

- **v1.0.0** — first stable glossary  
- Future changes that alter definitions increment **minor**  
- Pure editorial changes increment **patch**  

