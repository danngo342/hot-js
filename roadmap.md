# HotJS Roadmap (Architectural Direction)

HotJS MVP establishes a deterministic, module‑level hot reload pipeline. The items below outline the natural evolution of the system based on its current architecture. These are directional notes, not commitments.

## 1. Dependency‑Graph Traversal
Expand reload boundaries beyond direct imports to support full graph‑aware invalidation. This enables more precise update propagation across complex module graphs.

## 2. Transitive Invalidation
Allow reloads to propagate through indirect dependents, improving granularity and reducing unnecessary module refreshes.

## 3. Atomic Reload Units
Introduce SCC‑based condensation of cyclic dependencies into stable reload groups. This ensures consistent behavior when modules participate in dependency cycles.

## 4. Export‑Level Hot‑Swap
Enable selective replacement of individual exports without reloading entire modules. This reduces reload cost and improves developer feedback loops.

## 5. AST‑Aware Reload Boundaries
Use syntax‑level signals to refine reload granularity. AST‑aware boundaries allow HotJS to avoid invalidating modules when changes do not affect their public surface.

## 6. Batching & Coalescing
Group related updates to avoid reload storms and improve overall responsiveness during rapid file changes.

---

This roadmap is descriptive rather than prescriptive. It reflects the natural architectural trajectory of HotJS given its deterministic design and runtime‑agnostic foundation.
