import fs from 'fs';
import path from 'path';
import { restartProcess } from './lifecycle.js';

export function startWatcher(entry) {
  let timer = null;

  function debouncedRestart(info) {
    clearTimeout(timer);
    timer = setTimeout(() => restartProcess(entry, info), 50);
  }

  fs.watch(path.dirname(entry), { recursive: true }, (event, filename) => {
    if (!filename) return;

    debouncedRestart({ event, filename });
  });
}
