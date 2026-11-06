import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";
/** Preserve notices for the packages actually present in the player bundle. */
export function runtimeLicenses(): Plugin {
  return {
    name: "smashy-runtime-notices",
    generateBundle(_options, bundle) {
      const roots = new Set<string>([path.resolve("node_modules/vite")]);
      for (const output of Object.values(bundle))
        if (output.type === "chunk")
          for (const id of Object.keys(output.modules)) {
            const normal = id.replaceAll("\0", "").replaceAll("\\", "/"),
              start = normal.lastIndexOf("/node_modules/");
            if (start < 0) continue;
            const rest = normal.slice(start + 14).split("/");
            const count = rest[0]?.startsWith("@") ? 2 : 1;
            roots.add(
              normal.slice(0, start + 14) + rest.slice(0, count).join("/"),
            );
          }
      const notices = [...roots]
        .map((root) => {
          const pkg = JSON.parse(
            fs.readFileSync(path.join(root, "package.json"), "utf8"),
          );
          const names = fs
            .readdirSync(root)
            .filter(
              (name) =>
                /^(license|licence|copying)(\.|$)/i.test(name) &&
                fs.statSync(path.join(root, name)).isFile(),
            );
          const fallback =
            pkg.name === "@pixi/colord" && pkg.version === "2.9.6"
              ? fs.readFileSync("licenses/colord-MIT.txt", "utf8")
              : null;
          if (!names.length && !fallback)
            throw new Error(`Missing runtime notice for ${pkg.name}`);
          return `${pkg.name} ${pkg.version} (${typeof pkg.license === "string" ? pkg.license : "package license"})\n${"=".repeat(60)}\n${names.length ? names.map((name) => fs.readFileSync(path.join(root, name), "utf8")).join("\n\n") : fallback}`;
        })
        .sort();
      this.emitFile({
        type: "asset",
        fileName: "LICENSES.txt",
        source:
          "Third-party runtime notices for Smashy\n\n" + notices.join("\n\n\n"),
      });
    },
  };
}
