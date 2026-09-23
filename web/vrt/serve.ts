// Tiny dependency-free static server for the built Storybook
// (`storybook-static/`), used as the VRT run's `webServer`.
//   deno run --allow-net --allow-read vrt/serve.ts <dir> <port>
import { extname, join, normalize } from "node:path";

const [root = "storybook-static", port = "6199"] = Deno.args;

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

Deno.serve({ port: Number(port), hostname: "127.0.0.1" }, async (req) => {
  let path = decodeURIComponent(new URL(req.url).pathname);
  if (path.endsWith("/")) path += "index.html";
  const file = normalize(join(root, path));
  if (!file.startsWith(normalize(root))) {
    return new Response("forbidden", { status: 403 });
  }
  try {
    const body = await Deno.readFile(file);
    return new Response(body, {
      headers: {
        "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      },
    });
  } catch {
    return new Response("not found", { status: 404 });
  }
});
