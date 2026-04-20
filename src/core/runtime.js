import { spawnProcess, restartProcess } from "./lifecycle.js";
import { startWatcher } from "./watcher.js";

export function run(entry) {
  // Start the initial process
  spawnProcess(entry);

  // Start the watcher
  startWatcher(entry, (info) => {
    restartProcess(entry, info);
  });
}
