import { spawn } from "child_process";
import { log } from "../utils/logger.js";

let child = null;

export function spawnProcess(entry) {
  child = spawn("node", [entry], { stdio: "inherit" });

  child.on("exit", (code) => {
    log(`process exited with code ${code}`, "\x1b[90m");
  });
}

export function restartProcess(entry, info) {
  if (info) {
    log(
      `restart triggered: ${info.reason} → ${info.filename}`,
      "\x1b[33m"
    );
  }

  if (child) {
    log(`stopping child pid ${child.pid}`, "\x1b[90m");
    child.kill("SIGTERM");
  }

  spawnProcess(entry);
}
