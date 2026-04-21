hot.js Reload Lifecycle Specification
Version 1.2

Version	1.2
Date	2026-04-21
Status	Canonical
0. Preamble
hot.js is a minimal, deterministic configuration and module hot-reloader. This specification defines the canonical reload lifecycle: phase ordering, hook contracts, context shape, error semantics, cancellation behavior, and all determinism-critical invariants. Compliance with this specification is binary — partial compliance is non-compliance.

Normative keywords follow RFC 2119: MUST, MUST NOT, SHALL, SHALL NOT, SHOULD, SHOULD NOT, MAY.

1. Scope
This specification governs:

The ordered phases of a single reload cycle.
The shape, mutability, and lifetime of the ReloadContext object.
Hook registration, invocation order, and return-value contracts.
Error propagation, error-key namespacing, and fault boundaries.
In-flight cancellation classification and guarantees.
Dependency-graph identity via SCC lexical keying.
Immutability invariants across the entire pipeline.
Integration-mode constraints (process supervisor, POSIX signal, WebSocket bridge).
This specification does NOT govern: watcher implementation internals, filesystem polling strategy, or transport-layer encoding for the WebSocket bridge. Those belong to companion specifications.

2. Terminology
Reload Cycle — One complete, atomic traversal from phase DETECT through phase SETTLE.

Hook — A user-registered synchronous or async function invoked at a specific phase boundary.

ReloadContext — The immutable-by-default object threaded through every hook in a single reload cycle.

SCC (Strongly Connected Component) — A maximal set of modules where every module is reachable from every other module via dependency edges.

SCC Lexical Key — The canonical, deterministic identifier for an SCC, derived from byte-level POSIX sort of its constituent module paths.

In-Flight Reload — A reload cycle that has entered phase VALIDATE or later but has not yet reached phase SETTLE.

Supersession — Cancellation of an in-flight reload by a newer DETECT event, classified as supersede, coalesce, or abort.

Error Key — A namespaced string identifier attached to every error emitted by the pipeline or by user hooks.

Module Identity — The resolved, absolute, POSIX-normalized file path of a module.

Quiescence — The state in which no reload cycle is active and no DETECT events are pending.

3. Lifecycle Phases
A reload cycle consists of exactly eight ordered phases. Phases execute strictly sequentially — no phase overlaps with any other phase within the same cycle.

DETECT — The watcher layer emits a raw filesystem change event. This phase is pre-pipeline; no hooks fire. The event MUST carry the absolute, POSIX-normalized path of the changed file. Multiple raw events within the debounce window MUST be coalesced into a single DETECT before the pipeline advances. The debounce window is a configuration parameter with a default of 100ms.

VALIDATE — The pipeline resolves the changed path against the dependency graph. If the path maps to zero tracked modules, the cycle terminates silently (no hooks fire, no error emitted). If the path maps to one or more modules, each affected module's identity is recorded in the ReloadContext. Validation MUST be synchronous.

CANCEL_IN_FLIGHT — If an existing reload cycle is in-flight, the pipeline classifies the cancellation (see Section 8) and executes the classified cancellation protocol before proceeding. If no reload is in-flight, this phase is a no-op and completes in zero time.

BEFORE_RELOAD — All registered beforeReload hooks fire in registration order. Each hook receives a frozen snapshot of the ReloadContext. If any hook throws or rejects, the cycle short-circuits to ERROR_BOUNDARY (see Section 7). Hook return values are collected into an ordered array and frozen before the next phase.

TEARDOWN — The pipeline invokes module-level teardown for every affected module in reverse-dependency order (dependents before dependencies). Teardown MUST be invoked even if the module has no explicit teardown hook — in that case, teardown is a no-op for that module. The purpose is to release resources, cancel subscriptions, and clear side effects. Teardown hooks receive a frozen per-module TeardownContext (a subset of ReloadContext scoped to the specific module).

RELOAD — The pipeline invalidates and re-requires (or re-imports) every affected module. Module re-execution order follows the dependency graph in topological order (dependencies before dependents). Within an SCC, modules are re-executed in SCC Lexical Key order (see Section 5). If any module throws during re-execution, the error is captured and the cycle continues to ERROR_BOUNDARY with a partial-reload flag.

AFTER_RELOAD — All registered afterReload hooks fire in registration order. Each hook receives a frozen snapshot of the updated ReloadContext (reflecting the new module state). If any hook throws or rejects, the error is captured but does NOT prevent the cycle from reaching SETTLE. Captured errors are appended to the ReloadContext error ledger.

SETTLE — The pipeline marks the cycle complete, clears in-flight state, and transitions to quiescence. No hooks fire during SETTLE. The final, fully frozen ReloadContext is emitted as the cycle's terminal artifact. After SETTLE, the ReloadContext MUST NOT be mutated by any code path.

3.1 Phase Summary
#	Phase	Hooks Fire?	Mutates Context?	Can Short-Circuit?
1	DETECT	No	No (event only)	No
2	VALIDATE	No	Yes (module list)	Yes (no match → silent exit)
3	CANCEL_IN_FLIGHT	Cancellation hooks only	Yes (cancellation metadata)	No
4	BEFORE_RELOAD	Yes	No (frozen snapshot)	Yes (hook error → ERROR_BOUNDARY)
5	TEARDOWN	Yes (module-level)	No (frozen per-module)	No
6	RELOAD	No (module execution)	Yes (new module state)	Yes (throw → ERROR_BOUNDARY + partial flag)
7	AFTER_RELOAD	Yes	No (frozen snapshot)	No (errors captured, cycle continues)
8	SETTLE	No	No (final freeze)	No
4. ReloadContext Shape
interface ReloadContext {
  /** Monotonically increasing cycle identifier. Immutable after creation. */
  readonly cycleId: number;

  /** ISO 8601 timestamp of DETECT phase entry. Immutable after creation. */
  readonly detectedAt: string;

  /** Absolute POSIX-normalized paths of all affected modules.
   *  Immutable after VALIDATE. */
  readonly affectedModules: ReadonlyArray<string>;

  /** The module currently being processed in TEARDOWN or RELOAD phase.
   *  ── MUTABILITY MODEL (see Section 4.1) ──
   *  This field is WRITABLE by the pipeline during TEARDOWN and RELOAD only.
   *  It is null before TEARDOWN and after RELOAD completes.
   *  User hooks MUST NOT write to this field under any circumstances. */
  currentModule: string | null;

  /** SCC Lexical Keys for all SCCs containing affected modules.
   *  Immutable after VALIDATE. */
  readonly sccKeys: ReadonlyArray<string>;

  /** Ordered array of beforeReload hook return values.
   *  Immutable after BEFORE_RELOAD. */
  readonly hookResults: ReadonlyArray<unknown>;

  /** Error ledger. Append-only during the cycle; frozen at SETTLE. */
  readonly errors: ReadonlyArray<ReloadError>;

  /** Cancellation metadata. Null if no in-flight cancellation occurred.
   *  Immutable after CANCEL_IN_FLIGHT. */
  readonly cancellation: CancellationRecord | null;

  /** Integration mode active for this cycle. Immutable after creation. */
  readonly integrationMode: 'supervisor' | 'signal' | 'websocket';

  /** Arbitrary user-data bag. The pipeline never reads from or writes to
   *  this object. Users MAY mutate this object within hooks.
   *  The pipeline freezes it at SETTLE. */
  userData: Record<string, unknown>;
}
4.1 currentModule Mutability Model
This subsection is normative and defines the only mutable non-userData field on ReloadContext.

currentModule is initialized to null at ReloadContext creation.
The pipeline sets currentModule to the absolute path of the module entering TEARDOWN or RELOAD processing. This write occurs exactly once per module per phase.
The pipeline resets currentModule to null after each module completes its TEARDOWN or RELOAD processing.
After the RELOAD phase completes (all modules re-executed), currentModule is permanently set to null and MUST NOT be written again.
User hooks MUST NOT assign to currentModule. Any hook that writes to currentModule violates this specification and produces undefined behavior.
The currentModule field exists so that per-module teardown and reload hooks can identify which module they are operating on without the pipeline needing to pass a separate argument. It is a controlled window of mutability inside an otherwise frozen object.
Rationale: This controlled mutability avoids allocating a new context object per module per phase while preserving determinism. The write is pipeline-internal, unidirectional, and bounded.

5. SCC Lexical Key Invariant
This section defines the deterministic identity rule for Strongly Connected Components.

5.1 Definition
An SCC Lexical Key is the canonical string identifier for a Strongly Connected Component in the module dependency graph. It is computed as follows:

Collect the absolute, POSIX-normalized file paths of every module in the SCC.
Sort the collected paths using byte-level comparison in ascending order (equivalent to LC_COLLATE=C sort, equivalent to comparing raw UTF-8 byte sequences without locale-aware collation, case folding, or Unicode normalization).
The SCC Lexical Key is the first element of the sorted array (the lexicographically smallest path by raw bytes).
5.2 Invariants
The SCC Lexical Key MUST be stable across reload cycles for the same SCC composition. If the set of modules in an SCC does not change, its key MUST NOT change.
The sort order MUST be byte-level POSIX (LC_COLLATE=C). No locale-dependent collation, no case folding, no Unicode normalization (NFC, NFD, etc.) SHALL be applied. The raw byte sequence of the path string is the sole comparison input.
Within the RELOAD phase, modules belonging to the same SCC MUST be re-executed in SCC Lexical Key order — that is, in the same byte-level ascending sort used to derive the key. The module whose path IS the SCC Lexical Key executes first within its SCC.
In the TEARDOWN phase, SCC members are torn down in reverse SCC Lexical Key order (last in sort order first).
SCC Lexical Keys are recorded in ReloadContext.sccKeys during the VALIDATE phase and are immutable thereafter.
If an SCC contains exactly one module, the SCC Lexical Key is that module's path. The single-module case is not special-cased — it follows the same algorithm.
5.3 Rationale
Filesystem watchers, directory enumerators, and import/require resolution may return paths in non-deterministic order across platforms, runtimes, and filesystem implementations. The SCC Lexical Key eliminates this entropy source by imposing a total order derived solely from the byte content of the path strings. This guarantees identical reload sequencing on every platform, every run, regardless of watcher or OS behavior.

6. Hook Registration & Invocation
6.1 Registration
Hooks are registered via hot.on(phase, fn) where phase is one of: 'beforeReload', 'teardown', 'afterReload', 'onCancel'. Registration order is preserved. Duplicate registrations of the same function reference for the same phase are permitted and result in multiple invocations.

6.2 Invocation Order
Hooks for a given phase fire in strict registration order (FIFO). This order is determined at registration time and MUST NOT be reordered by the pipeline at invocation time. If hooks are registered across multiple files, the registration order follows module execution order, which itself follows the dependency graph (and SCC Lexical Key order within SCCs).

6.3 Synchronous and Asynchronous Hooks
Both sync and async hooks are permitted. Async hooks MUST be awaited before the next hook in the same phase fires. The pipeline MUST NOT parallelize hook execution within a phase. Cross-phase ordering already guarantees sequential execution.

6.4 Hook Return Values
beforeReload hooks MAY return a value. Return values are collected in registration order into ReloadContext.hookResults and frozen (Object.freeze, shallow) before the TEARDOWN phase begins.
teardown hooks MUST NOT return meaningful values. Any returned value is discarded.
afterReload hooks MUST NOT return meaningful values. Any returned value is discarded.
onCancel hooks MUST NOT return meaningful values. Any returned value is discarded.
6.5 Hook Error Behavior
Phase	Error Behavior
beforeReload	First error short-circuits remaining hooks. Cycle jumps to ERROR_BOUNDARY. Error recorded in ReloadContext.errors.
teardown	Error is captured in ReloadContext.errors. Remaining modules continue teardown. Cycle does NOT short-circuit.
afterReload	Error is captured in ReloadContext.errors. Remaining hooks continue. Cycle does NOT short-circuit.
onCancel	Error is captured in the cancelling cycle's ReloadContext.errors. Remaining onCancel hooks continue.
7. Error Semantics & Reserved Error-Key Namespace
7.1 ReloadError Shape
interface ReloadError {
  /** Namespaced error key. See Section 7.2 for namespace rules. */
  readonly key: string;

  /** Phase in which the error occurred. */
  readonly phase: PhaseIdentifier;

  /** Module path, if the error is scoped to a specific module.
   *  Null for phase-level errors. */
  readonly module: string | null;

  /** The original thrown value (Error object, string, or unknown).
   *  Frozen at capture. */
  readonly cause: unknown;

  /** Monotonic timestamp (performance.now or equivalent) of capture. */
  readonly capturedAt: number;
}
7.2 Reserved Global Error-Key Namespace
Error keys use a colon-delimited namespace scheme.

Reserved prefix: hot:

All error keys beginning with hot: are reserved for the pipeline. User hooks MUST NOT emit error keys with this prefix. The pipeline MUST reject (throw) any attempt by user code to manually append an error with a hot:-prefixed key to the error ledger.

Error Key	Phase	Meaning
hot:validate:no-graph	VALIDATE	Dependency graph not initialized.
hot:validate:orphan	VALIDATE	Changed file not tracked in dependency graph.
hot:cancel:timeout	CANCEL_IN_FLIGHT	Cancellation of in-flight cycle exceeded timeout.
hot:cancel:hook-error	CANCEL_IN_FLIGHT	An onCancel hook threw during cancellation.
hot:before:hook-error	BEFORE_RELOAD	A beforeReload hook threw or rejected.
hot:teardown:hook-error	TEARDOWN	A teardown hook threw or rejected.
hot:reload:module-error	RELOAD	A module threw during re-execution.
hot:reload:partial	RELOAD	Reload completed but one or more modules failed.
hot:after:hook-error	AFTER_RELOAD	An afterReload hook threw or rejected.
hot:context:mutation	Any	Illegal mutation of a frozen ReloadContext field detected.
hot:context:currentModule-write	TEARDOWN / RELOAD	User code attempted to write to currentModule.
7.3 User Error Keys
User hooks SHOULD use a reverse-domain or scoped prefix for their error keys (e.g., myapp:config:parse-failed). User error keys MUST NOT begin with hot:. If a user hook emits an unkeyed error (a raw throw), the pipeline wraps it with the key unkeyed:<phase>:<module-path-or-'global'>.

7.4 Error Ledger Immutability
ReloadContext.errors is an append-only array during the cycle. Entries MUST NOT be removed, replaced, or mutated after insertion. Each entry is frozen (Object.freeze, shallow) at the moment of capture. The entire array is frozen at SETTLE.

8. In-Flight Cancellation Classification
When a new DETECT event occurs while a reload cycle is in-flight (between VALIDATE and SETTLE, exclusive), the pipeline MUST classify the cancellation before acting. There are exactly three cancellation classes.

8.1 Supersede
Condition: The new DETECT event's affected modules have zero overlap with the in-flight cycle's affected modules.

Protocol:

The in-flight cycle runs to completion (all remaining phases execute normally).
The new cycle begins after the in-flight cycle reaches SETTLE.
No onCancel hooks fire.
No cancellation metadata is recorded in either cycle's ReloadContext.
Note: This is not true cancellation — it is deferral. It is classified here because the pipeline must still make the determination.

8.2 Coalesce
Condition: The new DETECT event's affected modules partially or fully overlap with the in-flight cycle's affected modules, AND the in-flight cycle has not yet entered the RELOAD phase.

Protocol:

The in-flight cycle is halted at its current phase boundary (never mid-hook).
All registered onCancel hooks fire in registration order, receiving the in-flight ReloadContext with cancellation.type = 'coalesce'.
The affected module sets from both events are merged (set union).
A new reload cycle begins from VALIDATE with the merged set.
The coalesced cycle inherits the in-flight cycle's cycleId incremented by one, NOT the in-flight cycle's ReloadContext.
8.3 Abort
Condition: The new DETECT event's affected modules partially or fully overlap with the in-flight cycle's affected modules, AND the in-flight cycle has entered the RELOAD phase or later.

Protocol:

The in-flight cycle completes its current module's re-execution (never interrupted mid-module) but skips remaining modules.
AFTER_RELOAD hooks for the in-flight cycle fire with the partial-reload flag set (ReloadContext.errors includes hot:reload:partial).
SETTLE completes for the in-flight cycle.
All registered onCancel hooks fire in registration order, receiving the settled ReloadContext with cancellation.type = 'abort'.
A new reload cycle begins from DETECT for the new event.
8.4 CancellationRecord Shape
interface CancellationRecord {
  /** The classification that was applied. */
  readonly type: 'supersede' | 'coalesce' | 'abort';

  /** cycleId of the cycle that was cancelled (for coalesce/abort)
   *  or deferred-after (for supersede). */
  readonly previousCycleId: number;

  /** Affected modules of the cancelling (new) event. */
  readonly incomingModules: ReadonlyArray<string>;

  /** Phase the in-flight cycle had reached when cancellation
   *  was classified. */
  readonly interruptedAtPhase: PhaseIdentifier;

  /** Timestamp of classification. */
  readonly classifiedAt: number;
}
8.5 Cancellation Invariants
Classification MUST occur before any cancellation action. The pipeline MUST NOT cancel first and classify later.
A hook invocation MUST NOT be interrupted mid-execution. Cancellation halts occur at phase boundaries or module boundaries only.
The onCancel hook phase is not a lifecycle phase — it is a cancellation-specific side channel. It does not appear in the eight-phase lifecycle.
At most one cancellation classification occurs per DETECT event. If multiple DETECT events arrive simultaneously (within the debounce window), they are coalesced at the DETECT level before reaching CANCEL_IN_FLIGHT.
Cancellation timeout is a configuration parameter (default: 5000ms). If onCancel hooks do not complete within the timeout, the pipeline emits hot:cancel:timeout and proceeds.
9. Immutability Rules
This section consolidates every immutability invariant in the specification.

9.1 Universal Freeze Protocol
All objects surfaced to user hooks — ReloadContext snapshots, TeardownContext, CancellationRecord, ReloadError entries, and hookResults — are shallow-frozen (Object.freeze) before delivery. User code MUST NOT attempt to defeat freezing via Proxy, prototype mutation, or defineProperty. Such attempts produce undefined behavior.

9.2 Field-Level Immutability Schedule
Field	Writable During	Frozen At	Writer
cycleId	Construction only	Construction	Pipeline
detectedAt	Construction only	Construction	Pipeline
affectedModules	VALIDATE	End of VALIDATE	Pipeline
currentModule	TEARDOWN, RELOAD	End of RELOAD	Pipeline only (see §4.1)
sccKeys	VALIDATE	End of VALIDATE	Pipeline
hookResults	BEFORE_RELOAD	End of BEFORE_RELOAD	Pipeline (from hook returns)
errors	VALIDATE through AFTER_RELOAD (append-only)	SETTLE	Pipeline
cancellation	CANCEL_IN_FLIGHT	End of CANCEL_IN_FLIGHT	Pipeline
integrationMode	Construction only	Construction	Pipeline
userData	Any phase (user-writable)	SETTLE	User
9.3 Snapshot Isolation
Hooks in BEFORE_RELOAD and AFTER_RELOAD receive frozen snapshots of the ReloadContext. A snapshot is a shallow clone with all fields frozen at the moment of snapshot creation. Mutations to the live ReloadContext (e.g., the pipeline updating currentModule during RELOAD) MUST NOT propagate to previously delivered snapshots.

9.4 Post-SETTLE Immutability
After SETTLE completes:

The entire ReloadContext, including userData, is deeply frozen (recursive Object.freeze).
No code path — pipeline or user — may mutate any field or nested object.
The settled ReloadContext is the cycle's terminal artifact and MAY be retained for diagnostics, logging, or diffing against subsequent cycles.
10. Integration Modes
hot.js operates in exactly one of three integration modes per reload cycle. The mode is determined at startup and MUST NOT change during the process lifetime.

10.1 Process Supervisor Mode
The hot.js process is the parent supervisor. It spawns and manages the target process as a child. Reload triggers child restart via SIGTERM → wait → re-spawn. This mode provides the strongest isolation guarantees. The ReloadContext's integrationMode is 'supervisor'.

10.2 POSIX Signal Mode
hot.js sends a configurable POSIX signal (default: SIGHUP) to the target process. The target is responsible for handling the signal and reloading internally. hot.js does not manage the target's lifecycle. The ReloadContext's integrationMode is 'signal'.

10.3 WebSocket Bridge Mode
hot.js communicates reload events to the target via a WebSocket connection. The target runs a lightweight client that receives reload commands and executes module invalidation. This mode supports remote and browser-based targets. The ReloadContext's integrationMode is 'websocket'. The WebSocket protocol and message schema are defined in a companion specification.

10.4 Mode Invariants
Integration mode is set once at process startup and recorded in every ReloadContext.
The lifecycle phase ordering is identical across all three modes.
The RELOAD phase implementation differs per mode (child restart vs. signal vs. message), but the phase's position in the lifecycle, its error semantics, and its interaction with other phases are mode-invariant.
Hooks receive the same ReloadContext shape regardless of mode.
11. Watcher Constraints
11.1 Path Normalization
All file paths entering the pipeline from the watcher MUST be:

Absolute (no relative paths).
POSIX-normalized (forward slashes, no trailing slash, no . or .. segments).
Resolved against the real filesystem path (symlinks resolved to their targets).
11.2 Debounce
The watcher MUST debounce raw filesystem events. Multiple events for the same file within the debounce window (default: 100ms, configurable) collapse into a single DETECT. Multiple events for different files within the debounce window collapse into a single DETECT with all affected paths.

11.3 Ignore Rules
Ignore patterns are applied at the watcher level, before DETECT. Ignored files MUST NOT enter the pipeline. Default ignores: node_modules/**, .git/**, *.swp, *.tmp, *~. Custom ignores are additive to defaults.

12. Determinism Guarantees
This section summarizes the determinism contract.

Given the same dependency graph, the same set of changed files, and the same registered hooks, the reload cycle MUST produce the same hook invocation order, the same module re-execution order, and the same ReloadContext shape on every run, on every platform, on every runtime.
All sources of non-determinism — filesystem enumeration order, watcher event order, locale-dependent sorting, clock skew — are eliminated by the invariants in this specification (SCC Lexical Key, path normalization, debounce coalescence, monotonic timestamps).
The only permitted source of variance is the content of user hook logic. The pipeline's behavior is fully determined by its inputs; user hooks may introduce side effects, but the pipeline does not observe or depend on those side effects (except thrown errors).
If two reload cycles have identical inputs (same changed files, same graph, same hooks), their ReloadContexts MUST be structurally identical (deep equality) excluding timestamps and cycleId.
13. Conformance
An implementation conforms to this specification if and only if:

All eight lifecycle phases execute in the specified order with no omissions.
All immutability rules (Section 9) are enforced at runtime.
The SCC Lexical Key algorithm (Section 5) is implemented using byte-level POSIX sort.
The reserved error-key namespace (Section 7.2) is enforced — user code cannot emit hot:-prefixed keys.
In-flight cancellation is classified before action (Section 8).
Hook invocation order matches registration order with no reordering (Section 6.2).
The currentModule field follows the mutability model in Section 4.1 exactly.
Path normalization (Section 11.1) is applied to every path before pipeline entry.
Non-conformance in any single rule constitutes full non-conformance. There are no conformance levels or profiles.

— End of Specification —