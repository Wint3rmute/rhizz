/// <reference types="vitest/config" />
// Imported from "vitest/config" rather than plain "vite" — it re-exports
// Vite's defineConfig with the `test` field typed, so Vitest config can
// live alongside the existing Vite config instead of a separate file.
import { defineConfig } from "vitest/config";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
const dirname = typeof __dirname !== "undefined"
  ? __dirname
  : path.dirname(fileURLToPath(import.meta.url));

// More info at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon
export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  server: {
    fs: {
      allow: [".", "../crates/rhizz-wasm/pkg"],
    },
  },
  test: {
    projects: [{
      extends: true,
      test: {
        // Pure-function tests only for now, so no DOM environment is needed —
        // add jsdom/happy-dom + @testing-library/svelte when actual component
        // tests (rendering .svelte files) become the goal.
        include: ["src/**/*.test.ts"],
      },
    }, {
      extends: true,
      plugins: [
        // The plugin will run tests for the stories defined in your Storybook config
        // See options at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon#storybooktest
        storybookTest({
          configDir: path.join(dirname, ".storybook"),
        }),
      ],
      test: {
        name: "storybook",
        browser: {
          enabled: true,
          headless: true,
          provider: "playwright",
          instances: [{
            browser: "chromium",
          }],
        },
      },
    }],
  },
});
