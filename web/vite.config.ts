// Imported from "vitest/config" rather than plain "vite" — it re-exports
// Vite's defineConfig with the `test` field typed, so Vitest config can
// live alongside the existing Vite config instead of a separate file.
import { defineConfig } from "vitest/config";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  server: {
    fs: {
      allow: [".", "../crates/rhizz-wasm/pkg"],
    },
  },
  test: {
    // Pure-function tests only for now, so no DOM environment is needed —
    // add jsdom/happy-dom + @testing-library/svelte when actual component
    // tests (rendering .svelte files) become the goal.
    include: ["src/**/*.test.ts"],
  },
});
