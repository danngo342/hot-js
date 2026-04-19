import fs from "fs";
import path from "path";
import { log } from "../utils/logger.js";

// Very small, deterministic dependency graph substrate.
// No parsing yet — just structure and API.

export class DependencyGraph {
  constructor() {
    this.graph = new Map(); // file -> Set(dependencies)
  }

  addFile(file) {
    if (!this.graph.has(file)) {
      this.graph.set(file, new Set());
    }
  }

  addDependency(file, dep) {
    this.addFile(file);
    this.addFile(dep);
    this.graph.get(file).add(dep);
  }

  getDependencies(file) {
    return this.graph.get(file) || new Set();
  }

  getAllFiles() {
    return Array.from(this.graph.keys());
  }

  // placeholder for future SWC parsing
  buildFromEntry(entry) {
    log(`building dependency graph for ${entry}`, "\x1b[90m");

    // For now, just track the entry file itself.
    this.addFile(entry);

    // Later:
    // - read file
    // - parse imports
    // - resolve paths
    // - recursively build graph
  }
}

