export function log(msg, color = "\x1b[90m") {
  console.log(`${color}[hot]\x1b[0m ${msg}`);
}

