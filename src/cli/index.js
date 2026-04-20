import path from "path";
import { run } from "../core/runtime.js";

export function cli(argv) {
  const entry = argv[2];

  if (!entry) {
    console.error("Usage: hot <entry-file>");
    process.exit(1);
  }

  const abs = path.resolve(entry);
  run(abs);
}
