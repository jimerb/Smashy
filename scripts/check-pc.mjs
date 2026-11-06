import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import assert from "node:assert/strict";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
const scripts = [
  "browser-check",
  "input-check",
  "storage-browser-check",
  "assistance-browser-check",
  "campaign-restart-check",
  "descent-browser-check",
  "records-browser-check",
  "viewport-browser-check",
  "visual-check",
  "reliability-browser-check",
  "pc-clarity-pacing-check",
  "audio-availability-check",
];
if (process.argv.includes("--full")) scripts.push("modes-browser-check");
const started = Date.now(),
  steps = [];
const url = process.env.SMASHY_URL || "http://127.0.0.1:5173";
const audit = fs.readFileSync("review/build-audit.json"),
  manifest = JSON.parse(audit.toString("utf8"));
const auditSha = crypto.createHash("sha256").update(audit).digest("hex");
const expectedHtml = manifest.inventory.find(
  (f) => f.file === "dist/index.html",
)?.sha256;
async function servedHtmlHash() {
  const response = await fetch(url);
  assert(response.ok, "Play server did not return its index.");
  return crypto
    .createHash("sha256")
    .update(Buffer.from(await response.arrayBuffer()))
    .digest("hex");
}
const htmlHash = await servedHtmlHash();
assert.equal(
  htmlHash,
  expectedHtml,
  "The play server is not serving the audited production build. Start the correct compiled snapshot first.",
);
for (const script of scripts) {
  const stepStart = Date.now();
  process.stdout.write(`\nChecking ${script}\n`);
  const result = spawnSync(
    process.execPath,
    [
      path.join(root, "node_modules/tsx/dist/cli.mjs"),
      path.join(root, `scripts/${script}.ts`),
    ],
    {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, SMASHY_URL: url, SMASHY_BROWSER: "chrome" },
    },
  );
  steps.push({
    script,
    status: result.status,
    elapsedMs: Date.now() - stepStart,
  });
  if (result.error || result.status !== 0) {
    fs.writeFileSync(
      "review/pc-suite.json",
      JSON.stringify({ url, passed: false, steps }, null, 2),
    );
    throw result.error || new Error(`${script} failed`);
  }
}
assert.equal(
  await servedHtmlHash(),
  htmlHash,
  "Play build changed during the suite.",
);
assert.equal(
  crypto
    .createHash("sha256")
    .update(fs.readFileSync("review/build-audit.json"))
    .digest("hex"),
  auditSha,
  "Production audit changed during the suite.",
);
fs.writeFileSync(
  "review/pc-suite.json",
  JSON.stringify(
    {
      at: new Date().toISOString(),
      url,
      passed: true,
      elapsedMs: Date.now() - started,
      includesFullPuzzleUi: process.argv.includes("--full"),
      buildAuditSha256: auditSha,
      auditedHtmlSha256: htmlHash,
      auditedProductionMatch: true,
      boundary:
        "Installed headless desktop Chrome, isolated profiles. Individual reports distinguish fixtures, synthetic touch/viewport checks and bounded contrast/performance samples. No human/device/cross-browser certification.",
      steps,
    },
    null,
    2,
  ),
);
console.log(`PC suite passed: ${steps.length} scripts.`);
