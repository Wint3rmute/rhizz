import type { HandleClientError } from "@sveltejs/kit/hooks";

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

  // Announced *after* init, never before: the consoleLoggingIntegration above
  // is installed by init, so only a line printed after it can be forwarded.
  // Printed earlier this would be the one startup message that cannot reach
  // Sentry — invisible precisely when someone is asking why nothing arrives.
  // So this line both reports the decision and demonstrates it: seeing it in
  // Sentry's Logs tab is the end-to-end proof that forwarding is live.
  //
  // `environment` is included because it is one of the two ways a correctly
  // initialized SDK still shows nothing — Sentry filters by it. The DSN is
  // deliberately not logged.
  console.log(
    "Sentry: initialized, console logs are forwarded as Sentry logs",
    {
      environment: import.meta.env.MODE,
    },
  );
} else {
  // No DSN means no SDK at all, so unlike the line above this one can only
  // ever be read in the browser console. That is the whole point: a build with
  // no DSN explains "nothing shows up in Sentry" completely, and it is the
  // first thing to check.
  console.log("Sentry: not initialized, this build has no VITE_SENTRY_DSN", {
    environment: import.meta.env.MODE,
  });
}

// SvelteKit's `handleError` covers what never reaches a component: a rejected
// `load`, a failure in a `+layout`/page lifecycle, and — since SvelteKit 3 —
// rendering errors and *expected* ones too (`kind: "app"` from `error(...)`,
// `kind: "framework"` for its own 404s). The hook returns nothing, so those
// keep SvelteKit's own status and message; the only thing it does is log, and
// hand the error to Sentry, which is also what reaches this hook for errors
// thrown inside event handlers.
const reportClientError: HandleClientError = ({ error, event }) => {
  console.error("An error occurred on the client side:", error, event);
};

export const handleError = Sentry.handleErrorWithSentry(reportClientError);
