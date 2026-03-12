// Thin wrapper around rhizz-wasm. Provides typed compile() function.

import type { Source, CompileResult } from "./types.ts";

// wasm-pack --target web output: init() loads the .wasm, compile_sources is the binding.
import init, { compile_sources } from "rhizz-wasm/rhizz_wasm.js";

let ready = false;

export async function initWasm(): Promise<void> {
  if (ready) return;
  await init();
  ready = true;
}

export function compile(sources: Source[]): CompileResult {
  if (!ready) throw new Error("WASM not initialised — call initWasm() first");
  return compile_sources(sources) as CompileResult;
}
