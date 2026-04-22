# hot.js - Reload Lifecycle Specification

<table>
<tr>
<td>Version:</td>
<td>1.5.0</td>
</tr>
<tr>
<td>Status:</td>
<td>Normative Draft</td>
</tr>
<tr>
<td>Date:</td>
<td>2026-04-22</td>
</tr>
<tr>
<td>License:</td>
<td>MIT</td>
</tr>
</table>

This document defines the canonical reload lifecycle for the hot.js runtime. All
normative requirements use RFC 2119 keywords (MUST, MUST NOT, SHALL,
SHOULD, MAY). Informative notes are marked [Note].

## 2. Purpose and Scope

hot.js is a minimal, deterministic reload substrate for JavaScript module graphs. It
is a host-level orchestration tool and runtime orchestrator. hot.js is not a runtime
owner - it does not replace, subsume, or compete with frontend HMR
frameworks, server-side live-reload tools, or bundler-integrated hot-module
systems.

hot.js defines boundaries and granularity so that the reload pipeline remains
deterministic, transparent, and substrate-pure. Specifically, hot.js makes no
assumptions about:

· How modules are structured or authored.

· How application state is organized, persisted, or migrated.

· How UI rendering, server request handling, or any host environment
operates.

· How event listeners, subscriptions, or timers are attached or cleaned up.

· How caches, memoization stores, or derived data are invalidated.

<!-- PageBreak -->

· How an application restores state, reinitializes subsystems, or handles
reload side effects.

Scope: This specification covers the reload lifecycle only - the sequence of phases
from trigger through completion. File watching, process spawning, signal
handling, transport protocols, and integration modes are out of scope.

## 3. Definitions (Normative Glossary)

The following terms are normative. All subsequent sections reference these
definitions exclusively. Where a term appears in bold in the body of this
specification, it carries the meaning defined here.

Module - A single JavaScript source unit identified by a unique, stable
ModuleId. A Module is the smallest unit of source tracked by the runtime.

ModuleId - The unique, stable identifier for a Module. An opaque string, typically
a resolved file path. Two Modules are identical if and only if their ModuleIds are
identical. ModuleId comparison is byte-exact; no normalization is applied.

Dependency Graph (G) - A directed graph G = (V, E) where V is the set of all
Modules and E is the set of import edges. Each directed edge (a, b) ∈ E means
Module a statically imports Module b.

Strongly Connected Component (SCC) - A maximal set of Modules S ⊆ V such
that every Module in S is reachable from every other Module in S via directed
edges in G. A singleton Module with no self-edge forms a trivial SCC.

SCCGraph - The directed acyclic graph (DAG) formed by collapsing each SCC in
G into a single node. Edges in the SCCGraph represent inter-SCC dependencies.
The SCCGraph is guaranteed acyclic by definition.

SCC Lexical Key - A deterministic, order-independent, implementation-
independent structural fingerprint of an SCC. The construction algorithm is
defined in Section 7.

ReloadSet - The set of SCCs selected for reload in a given reload cycle. The
ReloadSet is computed from the set of changed ModuleIds and their transitive dependents in the SCCGraph, walking forward (toward dependents), NOT
backward (toward dependencies).

Reload Cycle - A single, atomic pass through the reload lifecycle, triggered by
one or more file-change events after debounce. A Reload Cycle proceeds through
Phases 0–5 in strict sequential order.

Dynamic Context - A per-Module, per-reload-cycle object providing the Module
with reload metadata. The exact shape is defined in Section 8.

currentModule - A field of the Dynamic Context. It is the ModuleId of the
Module currently being evaluated during this reload phase. It is NOT the "entry
module" or "changed module." It is always the Module whose evaluation is in
progress.

Hook - A user-defined function registered on a Module that the runtime invokes
at a defined lifecycle phase. Hooks are optional, observational, and MUST NOT
alter reload semantics.

Commit - The atomic act of replacing the previous module graph state with the
newly evaluated state for an SCC. Commit is all-or-nothing per SCC.

Divergence - Any observable difference in behavior between two conforming
implementations given identical inputs. The specification aims for zero divergence.
See Section 11 for classification.

Cancellation - The act of aborting a reload cycle before commit. Cancellation
semantics are defined in Section 10.

## 4. Core Model

### 4.1 Module Graph

The runtime maintains a Dependency Graph G = (V, E) of all loaded Modules.

· G is constructed from static import declarations. Dynamic imports (e.g.,
  `import()` expressions) are NOT part of G.

· G is immutable within a reload cycle. The graph is only updated between
  reload cycles.

· Every Module in V has a unique ModuleId. Duplicate ModuleIds are a
  specification violation.

### 4.2 Strongly Connected Components

The runtime decomposes G into its SCCs using Tarjan's algorithm or any
equivalent algorithm that produces identical SCC membership.

· SCCs are the atomic reload units. Modules within an SCC MUST reload,
  evaluate, commit, and fail together. There is no partial SCC reload.

· SCC membership is deterministic for a given G. Two implementations
  operating on the same G MUST produce the same SCC decomposition.

· A Module belongs to exactly one SCC.

### 4.3 SCCGraph

The SCCGraph is the DAG formed by collapsing SCCs. It is guaranteed acyclic.

· Reload order follows a valid topological order of the SCCGraph
  (dependencies before dependents).

· If multiple valid topological orders exist, the runtime MUST use
  lexicographic ordering of SCC Lexical Keys as the tiebreaker, producing a
  single deterministic total order.

· The topological sort with lexicographic tiebreaker MUST produce an
  identical sequence across all conforming implementations for the same
  SCCGraph.

### 4.4 SCC Lexical Keys

Each SCC has a Lexical Key computed by the algorithm defined in Section 7.

· Lexical Keys are stable under version changes: same structure produces the
  same key.

· Lexical Keys change on structural changes: different imports produce
  different keys.

· Lexical Keys are used for: deterministic ordering tiebreaks, cache keying,
  and identity across reload cycles.

## 5. Reload Lifecycle Phases

The lifecycle is a linear pipeline with no branching except error and cancellation
exits. Phases execute in strict sequential order: 0 → 1 → 2 → 3 → 4 → 5.

### 5.0 Phase 0: Trigger

· One or more file-system change events are received.

· The runtime debounces events. The debounce window is implementation-
  defined but MUST be documented.

· After debounce, the runtime computes the set of changed ModuleIds:
  `changedSet`.

· If `changedSet` is empty after debounce, no reload cycle is initiated.

### 5.1 Phase 1: Scope Resolution

· For each ModuleId in `changedSet`, find its containing SCC in the current
  SCCGraph.

· Compute the ReloadSet: the transitive closure of dependent SCCs in the
  SCCGraph, starting from the SCCs containing changedSet members, walking
  FORWARD (toward dependents).

· The ReloadSet includes the SCCs containing changedSet AND all
  downstream SCCs.

## [Note]

The direction is forward (dependents), not backward (dependencies). A change
in Module A causes A's SCC and all SCCs that depend on A's SCC to reload.

Dependencies of A are NOT reloaded.

### 5.2 Phase 2: Order Determination

Sort the ReloadSet into a deterministic total order:

1. Primary: Valid topological order of the SCCGraph (dependencies before
   dependents).

2. Tiebreaker: Lexicographic comparison of SCC Lexical Keys (ascending).

This produces the ReloadQueue: an ordered list of SCCs to process. The
ReloadQueue is immutable once computed. No hook, error, or runtime event MAY
modify it.

### 5.3 Phase 3: Evaluation

For each SCC in the ReloadQueue, in order:

3. For each Module in the SCC (ordered lexicographically by ModuleId):

   1. Create a fresh Dynamic Context for this Module (see Section 8).

   2. If the Module has registered a beforeReload hook, invoke it with the
      Dynamic Context.

   3. Evaluate the Module (execute its top-level code with the new source).

   4. If evaluation throws, the SCC enters the Error state. Go to step 5 below.

4. All Modules in the SCC have evaluated successfully.

5. Invoke afterEvaluate hooks for all Modules in the SCC (ordered lexicographically
   by ModuleId), passing the Dynamic Context.

6. Proceed to Phase 4 for this SCC.

7. **[Error path]**: If any Module in the SCC throws during evaluation:

   - The entire SCC is marked as FAILED.
   - No Modules in this SCC are committed.
   - An error event is emitted with the appropriate error-key (see Section 9).
   - The remaining SCCs in the ReloadQueue continue processing. SCC
     failure does NOT cancel the reload cycle.

### 5.4 Phase 4: Commit

For each SCC that completed Phase 3 successfully:

8. Atomically replace the previous module bindings with the newly evaluated
   bindings for all Modules in the SCC. This is all-or-nothing.

9. Invoke afterCommit hooks for all Modules in the SCC (ordered
   lexicographically by ModuleId), passing the Dynamic Context.

10. The SCC is now in the COMMITTED state.

Commit is irreversible. There is no rollback mechanism.

### 5.5 Phase 5: Completion

After all SCCs in the ReloadQueue have been processed (committed or failed):

    { reloadId, committedSCCs, failedSCCs, cancelledSCCs, duration }

## 6. Normative Reload Algorithm

The following pseudocode defines the canonical reload algorithm. All conforming
implementations MUST produce behavior equivalent to this algorithm for all
observable outputs.

    // Phase 0: already complete (changedSet provided post-debounce)

    FUNCTION reload (changedSet : Set<ModuleId>) -> ReloadResult:

        // Phase 1: Scope Resolution
        LET affectedSCCs = {}
        FOR EACH moduleId IN changedSet:
            LET scc = findSCC(moduleId, currentGraph)
            affectedSCCs.add(scc)

        LET reloadSet = transitiveForwardClosure(affectedSCCs, sccGraph)

        // Phase 2: Order Determination
        LET reloadQueue = topologicalSort(reloadSet, sccGraph)
        // Tiebreak: lexicographic by SCC Lexical Key (ascending)
        // reloadQueue is now a deterministic total order. Frozen.

        LET committed = []
        LET failed = []

        // Phase 3 + 4: Evaluate and Commit per SCC
        FOR EACH SCC IN reloadQueue:

            // Cancellation checkpoint
            IF cancellationRequested():
                emit('cancel', { reloadId, errorKey: 'hot.cancel.superseded' })
                RETURN { committed, failed, cancelled: remaining(reloadQueue) }

            LET evaluationSuccess = true
            LET evaluatedModules = []

            FOR EACH module IN lexicographicOrder(scc.modules):
                LET ctx = createDynamicContext(module, reloadId, changedSet)
                invokeHook(module, 'beforeReload', ctx)

                TRY:
                    evaluate(module)
                    evaluatedModules.push(module)
                CATCH error:
                    evaluationSuccess = false
                    emit('error', { scc, module, error, errorKey: classify(error) })
                    BREAK // entire SCC fails

            IF evaluationSuccess:
                FOR EACH module IN lexicographicOrder(scc.modules):
                    invokeHook(module, 'afterEvaluate', ctx)

                commitSCC(scc, evaluatedModules) // Phase 4a: atomic replace

                FOR EACH module IN lexicographicOrder(scc.modules):
                    invokeHook(module, 'afterCommit', ctx)

                committed.push(scc)
            ELSE:
                failed.push(scc)

        // Phase 5: Completion
        emit('reloadComplete', { reloadId, committed, failed, duration })
        RETURN { committed, failed }

## 7. SCC Lexical Key Algorithm

The following algorithm computes the Lexical Key for a given SCC. This algorithm
is normative. All conforming implementations MUST use this algorithm to produce
identical keys.

FUNCTION computeLexicalKey(scc: SCC) -> string:

    LET entries = []

    FOR EACH module IN scc.modules:
        LET deps =
            module.dependencies
                .filter(dep => scc.contains(dep))   // only intra-SCC deps
                .map(dep => dep.moduleId)
                .sort()                             // lexicographic ascending

        entries.push(module.moduleId + ' : ' + deps.join(', '))

    entries.sort() // lexicographic ascending

    LET canonical = entries.join(' ; ')
    RETURN SHA256(canonical)

### Key properties:

· Deterministic: The same SCC structure always produces the same key.

· Order-independent: Input module iteration order does not affect the result.

· Implementation-independent: Any conforming implementation MUST
  produce the same key for the same SCC structure.

· Cycle-agnostic: Represents the set of Modules and their structural
  relationships, not traversal paths.

· Purely structural: Derived only from ModuleIds and intra-SCC dependency
  edges. Source content, timestamps, and metadata are excluded.

· Finite: No recursion or cycle walking. The algorithm iterates each Module
  exactly once.

· The hash algorithm MUST be SHA-256. Implementations MUST NOT
  substitute other hash algorithms.

· String encoding for the SHA-256 input MUST be UTF-8.

<!-- PageBreak -->

## 8. Dynamic Context

The Dynamic Context is a per-Module, per-reload-cycle object provided to hooks
and available during Module evaluation. Its shape is normative:

DynamicContext {

    currentModule: ModuleId,
        // The ModuleId of the Module currently being evaluated

    reloadId: string,
        // Unique, opaque identifier for this reload cycle

    changedModules: Set<ModuleId>,
        // The original set of changed ModuleIds that triggered this cycle

    isFirstLoad: boolean,
        // True if this Module has never been loaded before

    previousError: Error | null,
        // Error from this Module's last failed evaluation, or null

    timestamp: number
        // Timestamp (ms since epoch) when this reload cycle began
}

### Invariants:

· currentModule MUST always equal the ModuleId of the Module whose
  evaluation is currently in progress. It is NOT the entry module, NOT the first
  changed module, NOT the "root" module. It changes with each Module
  evaluation.

· reloadId is unique per reload cycle. Two distinct reload cycles MUST have
  distinct reloadIds. The format of reloadId is implementation-defined but
  MUST be an opaque string.

· changedModules is the original changedSet from Phase 0. It is immutable and
  identical for all Modules in the same reload cycle.

· isFirstLoad is true only on the Module's very first evaluation ever. All
  subsequent reloads set it to false.

· previousError is the error from the LAST failed evaluation of THIS Module,
  not from any other Module or any other reload cycle. If the Module has
  never failed, this is null.

· The Dynamic Context object is frozen (Object.freeze or equivalent). User
  code MUST NOT mutate it. The runtime MUST enforce immutability.

## 9. Hook Contract

### 9.1 Registered Hooks and Invocation Order

<table>
<tr>
<th>Hook</th>
<th>Invocation Point</th>
<th>Order Within SCC</th>
</tr>
<tr>
<td>beforeReload(ctx)</td>
<td>Before Module evaluation</td>
<td>Lexicographic by ModuleId</td>
</tr>
<tr>
<td>afterEvaluate(ctx)</td>
<td>After all Modules in the SCC have evaluated successfully</td>
<td>Lexicographic by ModuleId</td>
</tr>
<tr>
<td>afterCommit(ctx)</td>
<td>After the SCC has been committed</td>
<td>Lexicographic by ModuleId</td>
</tr>
</table>

### 9.2 Hook Constraints (Normative)

· Hooks MUST NOT throw.  
  If a hook throws, the runtime MUST catch the error, emit a diagnostic event  
  with error-key `hot.hook.error`, and continue the lifecycle.  
  Hook errors MUST NOT affect reload semantics.

· Hooks MUST NOT return values that affect the reload pipeline.  
  Return values are ignored.

· Hooks MUST NOT cancel reloads.

· Hooks MUST NOT reorder Modules.

· Hooks MUST NOT modify the Dependency Graph.

· Hooks MUST NOT modify the Dynamic Context.

· Hooks MUST NOT modify the ReloadQueue.

· Hooks are optional.  
  A Module with no hooks behaves identically to a Module with no-op hooks.

· Hooks are synchronous.  
  Async hooks are NOT supported.  
  If a hook returns a Promise, the Promise is ignored.

· Hooks are observational only.  
  They exist for side effects (logging, metrics, cleanup, state migration)  
  that do not alter determinism.

<!-- PageBreak -->

## 10. Error Classification

Error keys use a dot-separated namespace: `hot.<category>.<specific>`.  
The namespace is normative and closed.

<table>
<tr>
<th>Error Key</th>
<th>Description</th>
</tr>
<tr>
<td>hot.eval.syntax</td>
<td>Parse or syntax error during Module evaluation.</td>
</tr>
<tr>
<td>hot.eval.runtime</td>
<td>Runtime exception during Module evaluation.</td>
</tr>
<tr>
<td>hot.eval.timeout</td>
<td>Module evaluation exceeded the implementation-defined timeout.</td>
</tr>
<tr>
<td>hot.graph.cycle</td>
<td>[Reserved] A cycle was detected that could not form a valid SCC. This SHOULD NOT occur if the graph algorithm is correct.</td>
</tr>
<tr>
<td>hot.graph.missing</td>
<td>A ModuleId in the Dependency Graph could not be resolved.</td>
</tr>
<tr>
<td>hot.commit.failed</td>
<td>The atomic commit operation for an SCC failed.</td>
</tr>
<tr>
<td>hot.hook.error</td>
<td>A hook threw an exception. Diagnostic only; does not affect lifecycle.</td>
</tr>
<tr>
<td>hot.cancel.superseded</td>
<td>The reload cycle was cancelled because a newer trigger superseded it.</td>
</tr>
<tr>
<td>hot.cancel.explicit</td>
<td>The reload cycle was cancelled by an explicit runtime API call.</td>
</tr>
</table>

### Error classification invariants:

· Every error emitted by the runtime MUST have exactly one error key  
  from the namespace above.

· Error keys are strings.  
  They MUST match the pattern: `hot\.[a-z]+\.[a-z]+`

· The error-key namespace is closed.  
  Implementations MUST NOT invent new error keys outside this namespace.

· Error keys are classification labels, not error messages.  
  The associated error object contains the human-readable message.

## 11. Cancellation and Divergence

### 11.1 Cancellation

· A reload cycle MAY be cancelled if a new trigger arrives while the current
  cycle is in progress.

· Cancellation is checked ONLY between SCC processing boundaries  
  (between iterations of the ReloadQueue loop).  
  Cancellation MUST NOT interrupt Module evaluation mid-execution.

· If cancelled, all uncommitted SCCs are discarded.  
  Already-committed SCCs are NOT rolled back.

· A cancellation event is emitted with error-key `hot.cancel.superseded` and
  includes the reloadId of the cancelled cycle.

· The new trigger starts a fresh reload cycle from Phase 0.

### 11.2 Divergence Classification

<table>
<tr>
<th>Class</th>
<th>Severity</th>
<th>Definition</th>
<th>Status</th>
</tr>
<tr>
<td>Class A</td>
<td>Fatal</td>
<td>Two conforming implementations produce different committed module states for the same input.</td>
<td>MUST NOT occur. Indicates a specification violation.</td>
</tr>
<tr>
<td>Class B</td>
<td>Observable</td>
<td>Two conforming implementations produce different non-committed observable behaviors (e.g., different hook invocation timing, different error message text).</td>
<td>SHOULD be minimized. Tolerated for implementation-defined behaviors.</td>
</tr>
<tr>
<td>Class C</td>
<td>Cosmetic</td>
<td>Differences in logging, formatting, or diagnostic output.</td>
<td>Explicitly allowed.</td>
</tr>
</table>

<!-- PageBreak -->

## 12. Immutability Rules

The following objects are frozen at the specified points.  
Mutation after freezing is a specification violation.

<table>
<tr>
<th>Object</th>
<th>Frozen When</th>
</tr>
<tr>
<td>Dependency Graph G</td>
<td>Immutable within a reload cycle. Updated only between cycles.</td>
</tr>
<tr>
<td>ReloadSet</td>
<td>Immutable once computed (end of Phase 1).</td>
</tr>
<tr>
<td>ReloadQueue</td>
<td>Immutable once computed (end of Phase 2).</td>
</tr>
<tr>
<td>Dynamic Context</td>
<td>Frozen upon creation. User code and hooks MUST NOT mutate it.</td>
</tr>
<tr>
<td>SCC membership</td>
<td>Immutable within a reload cycle.</td>
</tr>
<tr>
<td>SCC Lexical Keys</td>
<td>Immutable within a reload cycle.</td>
</tr>
<tr>
<td>changedModules (changedSet)</td>
<td>Immutable for the lifetime of the reload cycle.</td>
</tr>
<tr>
<td>Error-key namespace</td>
<td>Immutable for the lifetime of a specification version.</td>
</tr>
</table>

## 13. Contracts and Guarantees

### 13.1 Runtime Guarantees to User Code

11. Deterministic reload order:  
    Given identical G and identical changedSet,  
    the ReloadQueue is identical across all conforming implementations.

12. Atomic SCC commit:  
    A committed SCC has all its Modules' bindings updated.  
    A failed SCC has none updated.

13. Isolation:  
    SCC failure does not prevent other SCCs from committing.

14. Hook safety:  
    Hook errors never affect reload semantics.

15. Context accuracy:  
    currentModule always reflects the Module currently being evaluated.

16. Immutable context:  
    The Dynamic Context cannot be corrupted by user code.

17. Cancellation safety:  
    Already-committed SCCs survive cancellation.

### 13.2 User Code Obligations to the Runtime

18. Hooks MUST be synchronous and MUST NOT throw.

19. User code MUST NOT depend on hook return values.

20. User code MUST NOT mutate the Dynamic Context.

21. User code MUST NOT depend on evaluation order within an SCC  
    being anything other than lexicographic by ModuleId.

## 14. Conformance

· A conforming implementation MUST implement all normative requirements  
  (MUST, MUST NOT, SHALL).

· A conforming implementation SHOULD implement all recommended  
  requirements (SHOULD).

· A conforming implementation MAY implement optional features (MAY).

· Implementation-defined behaviors MUST be documented in the  
  implementation's public specification or documentation.

· The implementation MUST use SHA-256 for SCC Lexical Key hashing.

· The implementation MUST produce zero Class A divergence  
  against the reference implementation.

· An implementation claiming conformance MUST identify the  
  specification version it conforms to.

<!-- PageBreak -->

## 15. Versioning Notes

<table>
<tr>
<td>Version:</td>
<td>1.5.0</td>
</tr>
<tr>
<td>Previous versions:</td>
<td>1.0.0, 1.2.2, 1.4.1</td>
</tr>
</table>

### Changes from v1.4.1:

· Pass 3 repairs applied: resolved all contradictions in SCC ordering,  
  cancellation bookkeeping, error-key conventions, currentModule semantics,  
  and ReloadSet interpretation.

· Clarified that ReloadSet walks FORWARD (toward dependents),  
  not backward (toward dependencies).

· Clarified that currentModule is ALWAYS the Module currently being  
  evaluated, not the entry or changed module.

· Unified SCC Lexical Key algorithm with explicit intra-SCC dependency filtering.

· Closed the error-key namespace — implementations MUST NOT extend it.

· Added cancellation checkpoint semantics (between SCC boundaries only).

· Added divergence classification (Class A/B/C).

· Added conformance section.

· Immutability rules consolidated into a single normative section.

· Hook contract strengthened: hooks are explicitly synchronous,  
  observational, and side-effect-only.

## Appendix A: Invariant Summary Table

<table>
<tr>
<th>ID</th>
<th>Invariant</th>
<th>Section</th>
<th>Classification</th>
</tr>

<tr>
<td>INV-01</td>
<td>currentModule MUST equal the ModuleId of the Module whose evaluation is currently in progress.</td>
<td>§8</td>
<td>Behavioral</td>
</tr>

<tr>
<td>INV-02</td>
<td>reloadId MUST be unique across all reload cycles.</td>
<td>§8</td>
<td>Determinism</td>
</tr>

<tr>
<td>INV-03</td>
<td>changedModules MUST be immutable and identical for all Modules in the same reload cycle.</td>
<td>§8, §12</td>
<td>Structural</td>
</tr>

<tr>
<td>INV-04</td>
<td>The Dynamic Context MUST be frozen upon creation. Mutation attempts MUST be rejected.</td>
<td>§8, §12</td>
<td>Structural</td>
</tr>

<tr>
<td>INV-05</td>
<td>Commit is atomic per SCC: all Modules' bindings are updated, or none are.</td>
<td>§5.4</td>
<td>Behavioral</td>
</tr>

<tr>
<td>INV-06</td>
<td>No partial SCC reload: all Modules in an SCC MUST reload, evaluate, commit, and fail together.</td>
<td>§4.2</td>
<td>Structural</td>
</tr>
</table>

<!-- PageBreak -->

<table>
<tr>
<th>ID</th>
<th>Invariant</th>
<th>Section</th>
<th>Classification</th>
</tr>

<tr>
<td>INV-07</td>
<td>SCC membership is deterministic for a given G and immutable within a reload cycle.</td>
<td>§4.2, §12</td>
<td>Structural</td>
</tr>

<tr>
<td>INV-08</td>
<td>The SCCGraph is guaranteed acyclic (DAG).</td>
<td>§4.3</td>
<td>Structural</td>
</tr>

<tr>
<td>INV-09</td>
<td>G is immutable within a reload cycle; updated only between cycles.</td>
<td>§4.1, §12</td>
<td>Structural</td>
</tr>

<tr>
<td>INV-10</td>
<td>SCC Lexical Keys are stable under version changes (same structure → same key).</td>
<td>§4.4, §7</td>
<td>Determinism</td>
</tr>

<tr>
<td>INV-11</td>
<td>ReloadSet walks FORWARD (toward dependents), never backward (toward dependencies).</td>
<td>§5.1</td>
<td>Behavioral</td>
</tr>

<tr>
<td>INV-12</td>
<td>The ReloadSet is immutable once computed (end of Phase 1).</td>
<td>§5.1, §12</td>
<td>Structural</td>
</tr>

<tr>
<td>INV-13</td>
<td>The ReloadQueue is immutable once computed and represents a deterministic total order.</td>
<td>§5.2, §12</td>
<td>Determinism</td>
</tr>

<tr>
<td>INV-14</td>
<td>Every error emitted MUST have exactly one error key from the closed namespace.</td>
<td>§10</td>
<td>Behavioral</td>
</tr>

<tr>
<td>INV-15</td>
<td>The error-key namespace is closed. Implementations MUST NOT extend it.</td>
<td>§10</td>
<td>Structural</td>
</tr>
</table>

<table>
<tr>
<th>ID</th>
<th>Invariant</th>
<th>Section</th>
<th>Classification</th>
</tr>

<tr>
<td>INV-16</td>
<td>Class A divergence (different committed states for same input) is a specification violation.</td>
<td>§11.2</td>
<td>Determinism</td>
</tr>

<tr>
<td>INV-17</td>
<td>Same G + same changedSet MUST produce same ReloadQueue across all conforming implementations.</td>
<td>§13.1</td>
<td>Determinism</td>
</tr>

<tr>
<td>INV-18</td>
<td>Tiebreaker for topological sort MUST be lexicographic comparison of SCC Lexical Keys (ascending).</td>
<td>§4.3, §5.2</td>
<td>Determinism</td>
</tr>

<tr>
<td>INV-19</td>
<td>Hook errors MUST NOT affect reload semantics. The runtime MUST catch and emit diagnostics.</td>
<td>§9</td>
<td>Behavioral</td>
</tr>

<tr>
<td>INV-20</td>
<td>Hooks are synchronous. Async hooks (Promises) are ignored.</td>
<td>§9</td>
<td>Behavioral</td>
</tr>

<tr>
<td>INV-21</td>
<td>Cancellation is checked ONLY between SCC boundaries. Mid-evaluation cancellation is prohibited.</td>
<td>§11.1</td>
<td>Behavioral</td>
</tr>

<tr>
<td>INV-22</td>
<td>Already-committed SCCs survive cancellation. Commit is irreversible.</td>
<td>§5.4, §11.1</td>
<td>Behavioral</td>
</tr>

<tr>
<td>INV-23</td>
<td>SCC Lexical Key hash algorithm MUST be SHA-256. No substitutions.</td>
<td>§7</td>
<td>Determinism</td>
</tr>

<tr>
<td>INV-24</td>
<td>Module evaluation order within an SCC MUST be lexicographic by ModuleId.</td>
<td>§5.3</td>
<td>Determinism</td>
</tr>

<tr>
<td>INV-25</td>
<td>isFirstLoad is true only on a Module's very first evaluation. All reloads set it to false.</td>
<td>§8</td>
<td>Behavioral</td>
</tr>
</table>

\- End of Specification -
