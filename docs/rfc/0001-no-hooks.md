# Doctrine Note: Why Hooks Are Permanently Out of Scope for hot.js

## 1. Purpose of the Substrate

hot.js exists to do one thing:

**Reload deterministically, and reload quickly.**

A deterministic reload substrate must guarantee:

- fixed evaluation order  
- fixed commit order  
- fixed propagation semantics  
- fixed SCC identity  
- fixed ReloadSet behavior  
- fixed cancellation points  

Any feature that introduces user-defined behavior inside this pipeline becomes a nondeterminism vector. Hooks are the largest such vector.

---

## 2. Hooks Introduce User Code Into the Reload Pipeline

When user code executes inside the reload lifecycle, the substrate loses control over:

- ordering  
- side effects  
- global state  
- evaluation timing  
- dependency assumptions  
- cancellation semantics  

Even synchronous hooks create observable differences in:

- reload timing  
- evaluation order dependencies  
- global state mutations  
- interleaving with other modules  

This violates the substrate’s determinism guarantees.

---

## 3. Hooks Create Hidden Dependencies

The import graph is the only source of truth for:

- SCC membership  
- reload propagation  
- evaluation order  

Hooks create implicit dependencies that do not exist in the graph:

- Module A’s hook mutates state Module B reads  
- Module C’s hook registers listeners Module D depends on  
- Module E’s hook clears caches that F expects to persist  

These dependencies are:

- invisible  
- untracked  
- unmodeled  
- unbounded  

This breaks the core invariant:

**All dependencies must be explicit and structural.**

---

## 4. Hooks Cause Ordering and Interleaving Contradictions

If two modules define hooks, the substrate must define:

- hook ordering within an SCC  
- hook ordering across SCCs  
- hook ordering across reload cycles  
- hook ordering across dependency chains  

This creates:

- interleaving hazards  
- sequencing hazards  
- race conditions (even in synchronous code)  
- nondeterministic global state  

The substrate becomes sensitive to user code, which is unacceptable.

---

## 5. Hooks Undermine Cancellation Semantics

Cancellation in hot.js is only allowed:

- between SCC boundaries  
- never mid-evaluation  

Hooks introduce new execution points that:

- may run before cancellation  
- may run after cancellation  
- may run during cancellation  
- may mutate state that cancellation assumes is stable  

This breaks the cancellation model.

---

## 6. Hooks Undermine Error Semantics

If hooks can throw, the substrate must define:

- how errors propagate  
- whether they cancel reloads  
- whether they fail SCCs  
- whether they affect commit  
- whether they affect evaluation order  

Even if all errors are caught, the substrate becomes:

- more complex  
- more fragile  
- more ambiguous  

Error semantics must remain structural, not behavioral.

---

## 7. Hooks Slow Down Reloads

Even lightweight hooks add:

- overhead  
- branching  
- user code execution  
- context creation  
- error handling  
- ordering constraints  

hot.js aims to:

**Reload in the minimum number of operations required by the graph.**

Hooks add operations that do not belong to the graph.

---

## 8. Hooks Require a Second Lifecycle Specification

If hooks exist, the substrate must define:

- beforeReload  
- afterEvaluate  
- afterCommit  
- error hooks  
- cancellation hooks  
- ordering rules  
- context rules  
- invariants  
- side-effect boundaries  

This becomes a second specification layered on top of the substrate.

hot.js should not have two specs.

---

## 9. Hooks Are Unnecessary for the Substrate’s Purpose

Frameworks that want stateful HMR can build their own hook systems on top of hot.js.

The substrate does not need to provide them.

hot.js is not:

- a UI framework  
- a state manager  
- a hydration engine  
- a runtime patcher  
- a hot-swap system  

It is a reload substrate.

---

# Doctrine Verdict

**Hooks are permanently out of scope for hot.js.  
Not in v1, not in v2, not internally, not externally.**

They contradict:

- determinism  
- purity  
- structural clarity  
- reload semantics  
- cancellation semantics  
- error semantics  
- SCC semantics  
- graph semantics  

hot.js remains clean, minimal, and deterministic by never allowing user code inside the reload pipeline.

Logging, metrics, and instrumentation can be implemented outside the substrate, without hooks.
