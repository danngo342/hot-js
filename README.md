# hot.js

A minimal, deterministic hot‑reload runtime.  
hot.js focuses on correctness, predictable lifecycle transitions, and
structured restart semantics rather than feature accumulation.

## Features

- Deterministic process lifecycle (single active child process)
- Structured restart reasons (`file-change`, `rename`, `unknown`)
- Clean watcher with consistent ignore rules
- Substrate for dependency‑graph–aware reloads
- Small enough to understand, extend, and reason about

## Usage

```bash
npx hot ./src/index.js
```

hot.js watches the directory of the entry file, applies ignore rules,
computes a typed restart reason, and restarts the child process with a
stable lifecycle envelope.

## Design Principles

- **Determinism over convenience**  
  Every restart is intentional, typed, and serialized.

- **Minimal surface area**  
  The runtime is deliberately small to keep behavior transparent.

- **Predictable lifecycle**  
  Child processes are cleanly terminated and replaced; no overlap, no drift.

- **Extensible substrate**  
  The graph layer provides a foundation for future reload strategies.

## Roadmap

- Dependency graph–aware restarts  
- Module‑level reload semantics  
- Integration with semantic runtime envelopes  

## License

MIT

