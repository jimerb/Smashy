import { defineConfig } from "vite";
import { runtimeLicenses } from "./scripts/licenses";
import fs from "node:fs";
export default defineConfig({
  base: "./",
  publicDir: false,
  plugins: [
    runtimeLicenses(),
    {
      name: "smashy-original-icon",
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "favicon.svg",
          source: fs.readFileSync("public/favicon.svg"),
        });
      },
    },
  ],
  build: { target: "es2022", sourcemap: true },
  server: {
    host: "127.0.0.1",
    fs: {
      deny: [
        ".env",
        ".env.*",
        "*.{crt,pem}",
        "**/.git/**",
        "**/.local/**",
        "**/reference/**",
        "**/research/**",
        "**/*-RESEARCH.md",
        "**/*-HANDOFF.md",
        "**/stats-*.txt",
      ],
    },
  },
});
