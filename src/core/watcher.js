import fs from "fs";
import path from "path";
import { restartProcess } from "./lifecycle.js";

const IGNORE = new Set([
  "node_modules",
  ".git",
  "out.txt",
  ".DS_Store",
]);

export function startWatcher(entry) {
  let timer = null;

  fs.watch(path.dirname(entry), { recursive: true }, (event, filename) => {
    if (!filename) return;

    for (const ignore of IGNORE) {
      if (filename.includes(ignore)) return;
    }

    const reason = event === "change"
      ? "file-change"
      : event === "rename"
      ? "rename"
      : "unknown";

    debouncedRestart({ event, filename, reason });
  });
}

