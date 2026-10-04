// Client-side VFS telemetry, reported to Sentry as custom metrics.
//
// The store (see ./vfsStore.ts) calls `reportVfsSizeBytes` after every
// persisted mutation with the byte size of the whole VFS blob, so Sentry's
// Metrics explorer shows how the blob grows over time — the early warning
// for when the "one JSON document" storage design stops scaling.
//
// Browser only: this module is imported solely by the browser composition
// root (ProjectState.svelte). Without a DSN the SDK is never initialized
// and the call below is a no-op (the SDK drops metrics with no client).
import * as Sentry from "@sentry/sveltekit";

/** Name of the VFS size gauge in Sentry's Metrics explorer. */
export const VFS_SIZE_METRIC = "vfs.size";

/**
 * Reports the current size of the whole persisted VFS blob, in bytes. A
 * gauge (not a distribution): each report replaces the previous value, so
 * the chart reads as "how big is the VFS right now".
 */
export function reportVfsSizeBytes(bytes: number): void {
  Sentry.metrics.gauge(VFS_SIZE_METRIC, bytes, { unit: "byte" });
}
