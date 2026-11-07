import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// A tiny file-backed "table" with a unique key. It stands in for a database
// with a unique constraint, and survives process restarts.
const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".data");

function file(name) {
  fs.mkdirSync(DIR, { recursive: true });
  return path.join(DIR, name);
}

export function has(name, id) {
  const f = file(name);
  return fs.existsSync(f) && fs.readFileSync(f, "utf8").split("\n").includes(id);
}

export function add(name, id) {
  fs.appendFileSync(file(name), `${id}\n`);
}

// True the first time it is called for this name, false afterwards.
export function once(name) {
  const f = file(name);
  if (fs.existsSync(f)) return false;
  fs.writeFileSync(f, "done\n");
  return true;
}
