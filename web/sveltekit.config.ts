// SvelteKit's project configuration, shared by `vite.config.ts` (dev/build)
// and `vitest.config.ts` (unit tests + Storybook stories).
//
// It is a module of its own because Vitest loads `vitest.config.ts` in
// preference to `vite.config.ts`, so a config inlined into either one reaches
// only half the builds: the other would compile components without
// `vitePreprocess()` (breaking every `lang="ts"` component) and without
// `experimental.async`.
import adapter from "@sveltejs/adapter-static";
import type { Config } from "@sveltejs/kit/vite";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

export const sveltekitConfig: Config = {
  preprocess: vitePreprocess(),
  compilerOptions: { experimental: { async: true } },
  adapter: adapter({ fallback: "404.html" }),
  paths: {
    // BASE_PATH is set when the app is served under a sub-path (see
    // rhizz-server); a dev server is always mounted at the root.
    base: process.argv.includes("dev") ? "" : process.env.BASE_PATH,
  },
};
