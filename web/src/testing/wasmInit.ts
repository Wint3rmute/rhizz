import init, { initSync } from "rhizz";

// Node's `fetch` rejects `file:` URLs, which is how the WASM glue loads
// `rhizz_wasm_bg.wasm` by default. Under Node (plain Vitest, no browser) we
// read the bytes from disk and hand them to `initSync` instead. Browsers keep
// the default fetch-based init.
export async function initWasmForTests(): Promise<void> {
  if (typeof process === "undefined" || !process.versions.node) {
    await init();
    return;
  }
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const wasmPath = fileURLToPath(
    import.meta.resolve("rhizz/rhizz_wasm_bg.wasm"),
  );
  initSync({ module: readFileSync(wasmPath) });
}
