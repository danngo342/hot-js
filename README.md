# hot.js

A zero‑dependency, deterministic hot‑reload runtime.  
HotJS focuses on correctness, predictable lifecycle transitions, and
structured reload semantics rather than feature accumulation.

## Features

- **Deterministic lifecycle** — single active child process with clean termination and restart.
- **Typed reload reasons** — consistent restart causes (`file-change`, `rename`, `unknown`).
- **Stable watcher** — strict ignore rules and predictable file‑system behavior.
- **Graph‑ready substrate** — current module‑level reload pipeline forms the foundation for future dependency‑graph–aware updates.
- **Small surface area** — easy to understand, extend, and reason about.

## Usage

```bash
npx hot ./src/index.js
```

HotJS watches the directory of the entry file, applies ignore rules,
computes a typed restart reason, and restarts the child process with a
stable lifecycle envelope.

## Design Principles

- **Determinism over convenience**  
  Every reload is intentional, typed, and serialized.

- **Minimal surface area**  
  The runtime is deliberately small to keep behavior transparent.

- **Predictable lifecycle**  
  Child processes are cleanly terminated and replaced; no overlap, no drift.

- **Extensible substrate**  
  The current architecture provides a foundation for more granular, graph‑aware reload strategies.

## Roadmap

See **[roadmap.md](roadmap.md)** for architectural direction and planned evolution.

## License

MIT
