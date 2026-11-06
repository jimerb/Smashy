import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
const args = process.argv.slice(2),
  option = (key, fallback) => {
    const i = args.indexOf(key);
    return i < 0 ? fallback : args[i + 1];
  };
const project = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const root = path.resolve(project, option("--dir", "dist"));
const port = Number(option("--port", "5173"));
const host = option("--host", "127.0.0.1");
const fallback = option("--fallback", "");
const fallbackRoot = fallback ? path.resolve(project, fallback) : null;
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("Choose a local port from 1024 to 65535.");
if (typeof host !== "string" || !host || host.startsWith("--"))
  throw new Error("Choose a server host, such as 127.0.0.1 or 0.0.0.0.");
if (!fs.existsSync(path.join(root, "index.html")))
  throw new Error("Build the game first, then start this server.");
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json",
  ".map": "application/json",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
};
const server = http.createServer((req, res) => {
  if (!["GET", "HEAD"].includes(req.method)) {
    res.writeHead(405);
    res.end();
    return;
  }
  try {
    const name = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    );
    let file = path.resolve(root, "." + name);
    const relative = path.relative(root, file);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory())
      file = path.join(file, "index.html");
    if (
      (!fs.existsSync(file) || !fs.statSync(file).isFile()) &&
      fallbackRoot &&
      name.startsWith("/assets/")
    ) {
      const previous = path.resolve(fallbackRoot, "." + name),
        // Decoded /assets/../ paths must remain in the assets directory too.
        relativePrevious = path.relative(
          path.join(fallbackRoot, "assets"),
          previous,
        );
      if (
        !relativePrevious.startsWith("..") &&
        !path.isAbsolute(relativePrevious) &&
        fs.existsSync(previous) &&
        fs.statSync(previous).isFile()
      )
        file = previous;
    }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404);
      res.end();
      return;
    }
    const size = fs.statSync(file).size;
    const headers = {
      "Content-Type": mime[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Accept-Ranges": "bytes",
      "Content-Length": size,
    };
    let start = 0,
      end = size - 1;
    // Safari's media loader seeks with single byte ranges, including suffixes.
    if (req.headers.range && req.method === "GET") {
      const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if (match && (match[1] || match[2])) {
        start = match[1]
          ? Number(match[1])
          : Math.max(0, size - Number(match[2]));
        end =
          match[1] && match[2]
            ? Math.min(Number(match[2]), size - 1)
            : size - 1;
      } else start = -1;
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start < 0 ||
        start >= size ||
        end < start
      ) {
        res.writeHead(416, {
          "Content-Range": `bytes */${size}`,
          "Content-Length": 0,
        });
        res.end();
        return;
      }
      res.writeHead(206, {
        ...headers,
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Content-Length": end - start + 1,
      });
    } else res.writeHead(200, headers);
    if (req.method === "HEAD" || size === 0) {
      res.end();
      return;
    }
    fs.createReadStream(file, { start, end }).pipe(res);
  } catch {
    res.writeHead(400);
    res.end();
  }
});
server.on("error", (e) => {
  console.error(
    e.code === "EADDRINUSE"
      ? `Port ${port} is already in use. Open http://127.0.0.1:${port}/ or close the prior Smashy server.`
      : e.message,
  );
  process.exitCode = 1;
});
server.listen(port, host, () => {
  const acceptsLAN = ["0.0.0.0", "::"].includes(host);
  let lanAddresses = [];
  if (acceptsLAN) {
    try {
      lanAddresses = [
        ...new Set(
          Object.values(os.networkInterfaces())
            .flatMap((addresses) => addresses ?? [])
            .filter((address) => address.family === "IPv4" && !address.internal)
            .map((address) => address.address),
        ),
      ];
    } catch {
      /* URL discovery must not prevent the server from starting. */
    }
  }
  const localHost = ["0.0.0.0", "::"].includes(host) ? "127.0.0.1" : host;
  const localURL = `http://${localHost.includes(":") ? `[${localHost}]` : localHost}:${port}/`;
  console.log(
    `Smashy stable playtest\nLocal URL: ${localURL}${lanAddresses.map((address) => `\nLAN URL: http://${address}:${port}/`).join("")}\nNo live reload. Serving ${path.relative(project, root)}. Ctrl+C stops the server.`,
  );
});
