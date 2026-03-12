import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: {
      "rhizz-wasm": resolve(__dirname, "../crates/rhizz-wasm/pkg"),
    },
  },
  optimizeDeps: {
    exclude: ["rhizz-wasm"],
  },
  server: {
    fs: {
      allow: [".", "../crates/rhizz-wasm/pkg"],
    },
  },
});
