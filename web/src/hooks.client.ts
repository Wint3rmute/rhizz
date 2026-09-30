// Sentry's entry point into the app. SvelteKit loads `hooks.client.ts` before
// anything else, so the SDK is in place before any page, component or layout
// code can run — an error thrown during the first render is captured rather
// than lost.
//
// The DSN comes from the build environment, like the VFS server URL does in
// ProjectState.svelte, and is never committed. With no DSN the SDK is not
// initialized at all: local development, Storybook, Vitest and the Playwright
// suite then send nothing and keep working with no network access.
import * as Sentry from "@sentry/sveltekit";
import type { HandleServerError } from "@sveltejs/kit";

const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;

if (dsn !== undefined && dsn !== "") {
  Sentry.init({
    dsn,

    // The documented default for a new project: errors plus tracing on every
    // transaction. Lower this once the volume matters — see
    // https://docs.sentry.io/platforms/javascript/configuration/options/#traces-sample-rate
    tracesSampleRate: 1.0,

    // Vite's mode is "development" for `deno task dev` and "production" for a
    // build — the same split the SDK infers on its own, stated explicitly so
    // the value is visible in the config.
    environment: import.meta.env.MODE,
    // No `release` here on purpose: `sentrySvelteKit()` in vite.config.ts
    // injects `window.SENTRY_RELEASE` into the build (from SENTRY_RELEASE, or
    // the git sha), which is the same release its source maps are uploaded
    // under. Setting it independently could tag the two differently.
    integrations: [
      // send console.log, console.warn, and console.error calls as logs to Sentry
      Sentry.consoleLoggingIntegration({ levels: ["log", "warn", "error"] }),
    ],
  });
}

// SvelteKit's `handleError` covers what never reaches a component: a rejected
// `load`, a failure in a `+layout`/page lifecycle. Errors thrown inside an
// event handler that Svelte catches itself are reported by the SDK's Svelte
// integration without this hook.
const reportClientError: HandleServerError = ({ error, event }) => {
  console.error("An error occurred on the client side:", error, event);
};

export const handleError = Sentry.handleErrorWithSentry(reportClientError);
