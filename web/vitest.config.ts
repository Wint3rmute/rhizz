// Vitest-only config, split out of vite.config.ts on purpose: the
// @storybook/addon-vitest plugin touches Node worker APIs (process.channel)
// at import time, which Deno's Node-compat layer (`dx`) does not implement.
// Keeping it out of vite.config.ts means `vite dev`/`vite build` load
// cleanly under both plain Node and `dx` (Deno). Vitest prefers
// vitest.config.ts over vite.config.ts automatically; `extends: true` in
// each project inherits the shared plugins below.
import { defineConfig } from "vitest/config";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { playwright } from "@vitest/browser-playwright";
import { sveltekitConfig } from "./sveltekit.config.ts";

// Vite can load this config natively, where `__dirname` is undefined.
const dirname = import.meta.dirname;

// More info at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon
export default defineConfig({
  plugins: [tailwindcss(), sveltekit(sveltekitConfig)],
  server: {
    fs: {
      allow: [".", "../crates/rhizz-wasm/pkg"],
    },
  },
  test: {
    coverage: {
      provider: "v8",
      thresholds: {
        // Requires 70% function coverage
        functions: 70,
      },
    },
    projects: [{
      extends: true,
      test: {
        name: "unit_tests",
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
          provider: playwright(),
          instances: [{
            browser: "chromium",
            // Play functions assert settled geometry. Transitions honor this
            // and cut instead of fading, same as the e2e browser.
            context: {
              reducedMotion: "reduce",
            },
          }],
        },
      },
    }],
  },
});
