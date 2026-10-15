import type { HandleClientError } from "@sveltejs/kit/hooks";

// Sentry's entry point into the app. SvelteKit loads `hooks.client.ts` before
// anything else, so the SDK is in place before any page, component or layout
// code can run — an error thrown during the first render is captured rather
// than lost.
//
// `VITE_RHIZZ_DEPLOYMENT` picks the mode, read at build time:
//   - "prod": events are sent to Sentry through the rhizz server's tunnel.
//   - anything else (including unset): nothing is sent, and no SDK is set up.
//     Local development, Storybook, Vitest and the Playwright suite run this way.
import * as Sentry from "@sentry/sveltekit";

const deployment = import.meta.env.VITE_RHIZZ_DEPLOYMENT as string | undefined;

// The Sentry project's public ingest key. It ships in every browser bundle
// anyway, so it is committed here rather than passed in at build time. The
// same value is in fly.toml.
const PROD_DSN =
  "https://c5757f769377fa9b99d42e5956213cbb@o4512171156045824.ingest.de.sentry.io/4512175383314512";

if (deployment === "prod") {
  Sentry.init({
    dsn: PROD_DSN,

    // Every envelope (errors, logs, traces, replays, profiles, metrics) is posted
    // to the rhizz server, which forwards it to Sentry. Same-origin, so ad
    // blockers that block Sentry's ingest host do not block it.
    tunnel: "/api/sentry",

    // The documented default for a new project: errors plus tracing on every
    // transaction. Lower this once the volume matters — see
    // https://docs.sentry.io/platforms/javascript/configuration/options/#traces-sample-rate
    tracesSampleRate: 1.0,

    environment: "production",
    // No `release` here on purpose: `sentrySvelteKit()` in vite.config.ts
    // injects `window.SENTRY_RELEASE` into the build (from SENTRY_RELEASE, or
    // the git sha), which is the same release its source maps are uploaded
    // under. Setting it independently could tag the two differently.
    integrations: [
      // Tracing must be enabled for profiling to work: every transaction
      // carries profiling data while a trace is active (see
      // `profileLifecycle: "trace"` below).
      Sentry.browserTracingIntegration(),

      // Browser profiling (JS self-profiling). Only starts when the document
      // response carries `Document-Policy: js-profiling` — see
      // `src/hooks.server.ts` (dev) and `crates/rhizz-server/src/server.rs`
      // (production static serving).
      Sentry.browserProfilingIntegration(),

      // send console.log, console.warn, and console.error calls as logs to Sentry
      Sentry.consoleLoggingIntegration({ levels: ["log", "warn", "error"] }),

      // Session Replay: a recording of the DOM leading up to a report, so a
      // bug report can be read as "what the user actually saw" instead of
      // reconstructed from a stack trace.
      //
      // `maskAllText: false` and `blockAllMedia: false` record text and media
      // verbatim — that is the point of a replay for this app, where the
      // subject *is* the picture (component labels, port names, annotation
      // text). It is also the reason replays can contain whatever a user typed
      // into a text field, so treat replay access as production data access.
      Sentry.replayIntegration({
        maskAllText: false,
        blockAllMedia: false,
      }),
    ],

    // Session Replay sampling. `replaysOnErrorSampleRate: 1.0` keeps every
    // session that produced an error, which is the whole reason to have replay
    // at all; the 10% baseline is the standing sample of everything else.
    //
    // Both are development-time knobs: set `replaysSessionSampleRate` to 1.0
    // while testing so every session arrives, then lower it again — the
    // on-error rate is meant to stay at 1.0.
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,

    // Browser profiling sampling. The decision whether to profile is made once
    // per session when the SDK initializes; 1.0 profiles every session.
    // `profileLifecycle: "trace"` ties profiling to active traces, so with
    // `tracesSampleRate: 1.0` above every transaction carries profile data.
    profileSessionSampleRate: 1.0,
    profileLifecycle: "trace",

    // URLs for which distributed tracing headers are attached. Matched
    // against the full request URL, so the API pattern must allow any host:
    // localhost covers dev servers, /\/api\// covers the same-origin VFS
    // API wherever the app is deployed (including https://rhizz.fly.dev,
    // listed explicitly so the production origin keeps working even if the
    // pattern above ever changes).
    tracePropagationTargets: ["localhost", "https://rhizz.fly.dev", /\/api\//],
  });

  // Announced *after* init, never before: the consoleLoggingIntegration above
  // is installed by init, so only a line printed after it can be forwarded.
  // Seeing this line in Sentry's Logs tab is the end-to-end proof that
  // forwarding is live.
  console.log(
    "Sentry: initialized, console logs are forwarded as Sentry logs",
    { environment: "production" },
  );
} else {
  // No SDK at all in dev: nothing is sent, and no integrations are installed,
  // so console output stays in the browser console only.
  console.log(
    "Sentry: not initialized, dev deployment: errors are logged to the browser console only",
    { deployment: deployment ?? null },
  );
}

// SvelteKit's `handleError` runs for everything that never reaches a
// component: a rejected `load`, a rendering failure, and *expected* errors
// too (`kind: "app"` from `error(...)`, `kind: "framework"` for SvelteKit's
// own 404s). Returning nothing keeps SvelteKit's own status and message, so
// all this does is log — and hand the error to Sentry, which is also what
// reaches this hook for errors thrown inside event handlers.
const reportClientError: HandleClientError = ({ error, event }) => {
  console.error("An error occurred on the client side:", error, event);
};

export const handleError = Sentry.handleErrorWithSentry(reportClientError);
