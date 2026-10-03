import { defineConfig, loadEnv } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";
import { sentrySvelteKit } from "@sentry/sveltekit/vite";
import tailwindcss from "@tailwindcss/vite";
import { sveltekitConfig } from "./sveltekit.config.ts";

// Sentry's Vite plugin does two things: it uploads the build's source maps so
// stack traces in Sentry point at real source, and it stamps the release
// (SENTRY_RELEASE, or the git sha) into the bundle as `window.SENTRY_RELEASE`.
//
// Both need an auth token, which never lives in the repo. Without one the
// plugin skips the upload — but it would still switch on `build.sourcemap:
// "hidden"`, emitting `build/**/*.map` that nothing then deletes, because it
// resolves the delete glob from the SvelteKit adapter's output dir and
// adapter-static is not one it knows (it assumes `.svelte-kit/output`). Those
// maps would ship inside `web/build`, which `rhizz-server`'s build.rs embeds
// into the release binary. So the whole source-map half stays off unless a
// token is actually configured: a tokenless build emits no `.map` files at
// all, exactly as it did before Sentry. (The SDK itself is still bundled —
// that is the point of the setup — and stays dormant at runtime without a
// DSN; see src/hooks.client.ts.)
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const authToken = env.SENTRY_AUTH_TOKEN;

  const sentry = authToken === undefined ? { autoUploadSourceMaps: false } : {
    authToken,
    org: env.SENTRY_ORG,
    project: env.SENTRY_PROJECT,
    // adapter-static writes to `build/`, and the plugin's automatic cleanup
    // glob points at `.svelte-kit/output/`, so the uploaded maps have to be
    // deleted explicitly — otherwise the static output (and the binary that
    // embeds it) ships the sources Sentry just received.
    sourcemaps: { filesToDeleteAfterUpload: ["./build/**/*.map"] },
    // Set explicitly rather than left to detection: the plugin would
    // otherwise guess from package.json and find the `@sveltejs/adapter-auto`
    // devDependency, which it maps to Vercel.
    adapter: "other",
  };

  return {
    plugins: [
      // Before `sveltekit()`, as the Sentry docs require.
      sentrySvelteKit(sentry),
      tailwindcss(),
      sveltekit(sveltekitConfig),
    ],
    server: {
      fs: {
        allow: [".", "../crates/rhizz-wasm/pkg"],
      },
    },
  };
});
