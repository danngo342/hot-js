## v1 Normative Corrections

This section resolves contradictions and defines the minimum required rules for deterministic behavior across implementations.

---

### 1. Resolver Behavior (Authoritative vs Augmenting)

**Corrected Contract:**

- A resolver operates in one of two explicit modes:
  - **override** — resolver output *replaces* static dependents
  - **augment** — resolver output is *unioned* with static dependents

```ts
type ResolverMode = "override" | "augment";
```

**Required default:**  
`augment`

**Merge rules (augment mode):**

- `dependents = dedupe(staticDependents ∪ resolverDependents)`
- Resolver output always wins on conflicts (e.g., duplicates, cycles).

---

### 2. Reload Set Definition (Contract Alignment)

**Corrected Contract:**

The reload set is:

```
reloadSet = { changedModule }
          ∪ transitiveDependents(changedModule)
          ∪ explicitlyConfiguredModules
```

**Ordering:**  
Explicitly configured modules are treated as if they were dependents of the changed module.

---

### 3. Canonical Module ID Format

**Required canonical form:**

```
project-relative POSIX-style path
```

Examples:

- `src/utils/math.js`
- `lib/server/index.ts`

**Rules:**

- No absolute paths in graph nodes.
- No Windows backslashes.
- Normalization is required before graph insertion.

---

### 4. Deterministic Ordering Algorithm

**Required ordering strategy:**

1. **Topological sort** of the reload set  
2. **Lexical tie-break** for cycles or ambiguous ordering

This ensures:

- deterministic reload order  
- stable behavior across JS/Rust implementations  

---

### 5. Resolver Merge Rules (Normative)

**Required behavior:**

- Resolver output must be treated as a **set**, not a list.
- Duplicates must be removed.
- Ordering must follow the deterministic ordering algorithm.
- Resolver must not introduce modules that do not exist in the graph.

---

### 6. Explicitly Configured Modules (Source of Truth)

**Corrected Contract:**

Explicitly configured modules come from:

```ts
HotConfig.explicitReload: string[]
```

These modules are:

- normalized to canonical IDs  
- added to the reload set for every reload  
- ordered using the deterministic ordering algorithm  

---

### 7. Specifier Normalization Rules

**Required normalization:**

1. Convert to project-relative path  
2. Convert backslashes → forward slashes  
3. Resolve extensionless imports using:
   - `file.js`
   - `file.ts`
   - `file/index.js`
   - `file/index.ts`
4. Reject bare specifiers (e.g., `"react"`) unless resolver handles them

**Contract:**  
Graph edges must be stable across platforms and implementations.

---

### 8. Determinism Enforcement

All implementations (JS, Rust, etc.) must:

- use the same canonical ID rules  
- use the same ordering algorithm  
- apply resolver merge rules identically  
- compute reload sets using the corrected formula  

This ensures cross-language determinism.
