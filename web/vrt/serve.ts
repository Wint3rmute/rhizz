// Tiny dependency-free static server for the built Storybook
// (`storybook-static/`), used as the VRT run's `webServer`.
//   node vrt/serve.ts <dir> <port>
// Node runs .ts directly (type stripping), so no build step is needed.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const [root = "storybook-static", port = "6199"] = process.argv.slice(2);
const rootDir = resolve(root);

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
};

createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
  if (path.endsWith("/")) path += "index.html";
  const file = normalize(join(rootDir, path));
  if (!file.startsWith(rootDir)) {
    res.writeHead(403, { "content-type": "text/plain" }).end("forbidden");
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" }).end("not found");
  }
}).listen(Number(port), "127.0.0.1");
