import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { sourceDigest } from "./source-digest.mjs";
process.chdir(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
const before = sourceDigest();
for (const args of [
  ["node_modules/typescript/bin/tsc", "--noEmit"],
  ["node_modules/vite/bin/vite.js", "build"],
]) {
  const r = spawnSync(process.execPath, args, { stdio: "inherit" });
  if (r.error || r.status !== 0)
    throw r.error || new Error(`Build step failed: ${args[0]}`);
}
const after = sourceDigest();
if (before.digest !== after.digest)
  throw new Error("Source changed during build. Run the build again.");
fs.mkdirSync(".local", { recursive: true });
fs.writeFileSync(
  ".local/build-source.json",
  JSON.stringify({ at: new Date().toISOString(), ...after }, null, 2),
);
console.log(`Source/build stamp: ${after.digest}`);
