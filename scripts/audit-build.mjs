import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import assert from "node:assert/strict";
import { sourceDigest } from "./source-digest.mjs";
const walk = (dir) =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)],
    );
assert(fs.existsSync("dist/index.html"), "Run the production build first");
assert(
  fs.existsSync(".local/build-source.json"),
  "Build through pnpm build before auditing.",
);
const sources = JSON.parse(fs.readFileSync(".local/build-source.json", "utf8"));
assert.equal(
  sourceDigest().digest,
  sources.digest,
  "Source changed after the successful build. Rebuild before audit/package.",
);
const files = walk("dist");
// Background music and reward voices each have an explicit, separate allowlist.
const approvedMusic = [
  "01-relaxed-pocket-aac.m4a",
  "02-soft-pixel-play-aac.m4a",
  "03-cozy-game-loop-aac.m4a",
  "04-puzzle-pulse-aac.m4a",
];
const musicAssetPattern =
  /^(?:01-relaxed-pocket|02-soft-pixel-play|03-cozy-game-loop|04-puzzle-pulse)-aac-[\w-]+\.m4a$/;
const approvedRewardClips = ["wheeee-1.mp3", "wheeee-2.mp3", "ooo-smashy.mp3"];
const rewardAssetPattern = /^(?:wheeee-[12]|ooo-smashy)-[\w-]+\.mp3$/;
// Match this build machine's actual paths, rather than third-party examples
// such as generic user-folder examples or escaped source-map expressions.
const localPaths = [os.homedir(), process.cwd()].map((value) =>
  value.replace(/\\+/g, "/").toLowerCase(),
);
for (const [, reference] of fs
  .readFileSync("dist/index.html", "utf8")
  .matchAll(/(?:src|href)="([^"]+)"/g)) {
  const target = path.resolve("dist", reference);
  const relative = path.relative(path.resolve("dist"), target);
  assert(
    !relative.startsWith("..") &&
      !path.isAbsolute(relative) &&
      fs.existsSync(target),
    `Missing or external HTML asset: ${reference}`,
  );
}
const inventory = files.map((file) => {
  assert(
    /\.(html|js|css|map)$/.test(file) ||
      ["LICENSES.txt", "favicon.svg"].includes(path.basename(file)) ||
      musicAssetPattern.test(path.basename(file)) ||
      rewardAssetPattern.test(path.basename(file)) ||
      /^(?:workshop-night-ready-v1-[\w-]+\.webp|smashy-(?:wordmark|logo-primary)-ready-v1-[\w-]+\.png|(?:chip|gum|rivet|wisp|bash|loop|peb|anchor)-(?:sprite-ready|faceplate)-v1-[\w-]+\.png)$/.test(
        path.basename(file),
      ),
    `Unexpected production asset: ${file}`,
  );
  const data = fs.readFileSync(file);
  const text = data.toString("utf8");
  const normalizedText = text.replace(/\\+/g, "/").toLowerCase();
  assert(
    !localPaths.some((prefix) => normalizedText.includes(prefix)) &&
      !/(?:reference|research)\/(?:[^\s"']+\.(?:exe|dll|wav|bmp))/i.test(text),
    `Private reference or local machine path in ${file}`,
  );
  return {
    file: file.replaceAll("\\", "/"),
    bytes: data.length,
    sha256: crypto.createHash("sha256").update(data).digest("hex"),
  };
});
const musicFiles = inventory.filter((row) =>
  musicAssetPattern.test(path.basename(row.file)),
);
assert.equal(
  musicFiles.length,
  approvedMusic.length,
  "Package all four soundtrack files exactly once",
);
for (const source of approvedMusic) {
  const stem = source.slice(0, -4);
  const packaged = musicFiles.find((row) =>
    path.basename(row.file).startsWith(stem + "-"),
  );
  assert(packaged, `Missing soundtrack file: ${source}`);
  const expected = crypto
    .createHash("sha256")
    .update(fs.readFileSync(path.join("public/music", source)))
    .digest("hex");
  assert.equal(
    packaged.sha256,
    expected,
    `Packaged soundtrack bytes differ: ${source}`,
  );
}
const rewardClips = inventory.filter((row) =>
  rewardAssetPattern.test(path.basename(row.file)),
);
assert.equal(
  rewardClips.length,
  approvedRewardClips.length,
  "Package all three reward clips exactly once",
);
for (const source of approvedRewardClips) {
  const stem = source.slice(0, -4);
  const packaged = rewardClips.find((row) =>
    path.basename(row.file).startsWith(stem + "-"),
  );
  assert(packaged, `Missing reward clip: ${source}`);
  const expected = crypto
    .createHash("sha256")
    .update(fs.readFileSync(path.join("public/sounds", source)))
    .digest("hex");
  assert.equal(
    packaged.sha256,
    expected,
    `Packaged reward clip bytes differ: ${source}`,
  );
}
for (const dir of ["reference", "research", "design", ".local"])
  assert(
    !files.some((f) => f.replaceAll("\\", "/").split("/").includes(dir)),
    `Forbidden folder in output: ${dir}`,
  );
const sourceFiles = walk("src");
assert(
  !sourceFiles.some((f) =>
    /\.(exe|dll|wav|mp3|m4a|ogg|flac|png|jpg|webp)$/i.test(f),
  ),
  "Binary media must use the explicit original-asset import path",
);
for (const file of sourceFiles) {
  const text = fs.readFileSync(file, "utf8");
  assert(
    !/(?:from\s*|import\s*\(|url\s*\()[^\n]*(?:reference\/|research\/|design\/)/i.test(
      text,
    ),
    `Unapproved imported asset in ${file}`,
  );
}
const report = {
  sources,
  at: new Date().toISOString(),
  boundary:
    "Production file and source-import audit; explicit original art, procedural animation and sound effects, four owner-supplied soundtrack playback files, and three owner-supplied reward voice clips; not a legal or human aesthetic assessment.",
  runtimeAssets: {
    characters:
      "public/art/ready/* — exact pre-normalized original bodies, original clean faceplates and local facial-state layers; explicit imports with procedural fallback",
    board: "src/render/index.ts — original Pixi geometry",
    sound:
      "src/audio/index.ts — original synthesized cues and shared Sound effects mixing; supplied reward voices listed separately",
    rewardVoices:
      "public/sounds/wheeee-1.mp3, wheeee-2.mp3, ooo-smashy.mp3 — supplied reward samples on the shared Sound effects bus; 7–9 dropped support pieces choose one Wheeee; 10+ choose Ooo-Smashy only",
    music:
      "public/music/01-relaxed-pocket-aac.m4a, 02-soft-pixel-play-aac.m4a, 03-cozy-game-loop-aac.m4a, 04-puzzle-pulse-aac.m4a — AAC playback copies of the owner-supplied soundtrack, ordered looping playlist with independent volume/mute",
    icon: "public/favicon.svg — original mallet/block vector",
    fonts: "local system font stack; no font files or downloads",
    levels:
      "src/content/lessons.ts, src/content/puzzles.ts (50 authored identities / 100 explicit layouts), and original seeded core generation",
  },
  musicTracks: musicFiles,
  rewardClips,
  fileCount: files.length,
  bytes: inventory.reduce((n, f) => n + f.bytes, 0),
  inventory,
};
fs.mkdirSync("review", { recursive: true });
fs.writeFileSync("review/build-audit.json", JSON.stringify(report, null, 2));
console.log(
  `Production audit passed: ${files.length} allowlisted files; no private reference assets or machine paths.`,
);
