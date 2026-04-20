import fs from "fs";
import path from "path";
import { log } from "../utils/logger.js";

export function startWatcher(entry, onRestart) {
  const dir = path.dirname(entry);

  let timeout = null;

  function debouncedRestart(info) {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => onRestart(info), 50);
  }

  const watcher = fs.watch(
    dir,
    { recursive: true },
    (event, filename) => {
      if (!filename) return;

      const abs = path.join(dir, filename);

      // Ignore the smoke test's output log file
      if (filename.includes("output.log")) return;

      // Ignore dotfiles and node_modules
      if (filename.startsWith(".") || filename.includes("node_modules")) {
        return;
      }

      const reason =
        event === "rename"
          ? "rename"
          : event === "change"
          ? "file-change"
          : "unknown";

      // Optional: comment out for cleaner logs
      // if (reason !== "unknown") {
      //   log(`watch event: ${event} → ${filename}`, "\x1b[90m");
      // }

      debouncedRestart({
        event,
        filename: abs,
        reason,
      });
    }
  );

  log(`watching directory: ${dir}`, "\x1b[90m");

  return watcher;
}

