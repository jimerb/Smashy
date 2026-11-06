import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
const walk = (dir) =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)],
    );
export function sourceDigest() {
  const files = [
    ...walk("src"),
    ...(fs.existsSync("public") ? walk("public") : []),
    ...walk("licenses").filter((f) => f.endsWith(".txt")),
    "index.html",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "tsconfig.json",
    "vite.config.ts",
    "scripts/licenses.ts",
    "scripts/build.mjs",
    "scripts/source-digest.mjs",
  ]
    .sort()
    .map((file) => ({
      file: file.replaceAll("\\", "/"),
      sha256: crypto
        .createHash("sha256")
        .update(fs.readFileSync(file))
        .digest("hex"),
    }));
  return {
    digest: crypto
      .createHash("sha256")
      .update(JSON.stringify(files))
      .digest("hex"),
    files,
  };
}
