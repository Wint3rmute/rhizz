// Network activity tracking for the bottom-bar widget.
//
// A pure module (no Svelte runes) exposing a `fetch`-compatible wrapper that
// counts in-flight tracked requests and reports the current label. The three
// network call sites (`vfsStore.ts` `httpBackend`, `projectLock.svelte.ts`,
// `buildInfo.ts`) inject the shared `trackedFetch` as their `fetchImpl` —
// their logic stays untouched; only the transport is wrapped.
//
// Tracked ops (per-endpoint label map):
//   PUT …/files      → Uploading…
//   GET /api/vfs     → Syncing… (initial load and follower reloads)
//   POST …/lock      → Acquiring lock…
//   POST …/release   → Releasing lock…
// Background noise (never tracked, never displayed):
//   lock poll (GET …/state), heartbeat (POST …/heartbeat), /api/version.
// Everything else is untracked too (corrupt-free defaults: unknown
// endpoints never light the widget).
//
// Display rules live here so unit tests can pin them with fake timers:
// - show only if a tracked request stays in flight longer than
//   ACTIVITY_INDICATOR_DELAY_MS (fast localhost ops never flicker);
// - when the last request settles, keep the final label and fade for
//   ACTIVITY_FADE_OUT_MS instead of hiding at once; a new request cancels
//   the fade;
// - a rejected tracked request (e.g. offline) shows an error label
//   immediately (bypassing the delay) with the same fade;
// - under `prefers-reduced-motion` the fade is skipped (instant hide).

/** Show the indicator only if a request stays in flight longer than this. */
export const ACTIVITY_INDICATOR_DELAY_MS = 300;

/** Fade-out length once the last tracked request settles (~500ms). */
export const ACTIVITY_FADE_OUT_MS = 500;

export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

const LABEL_UPLOADING = "Uploading…";
const LABEL_SYNCING = "Syncing…";
const LABEL_ACQUIRING = "Acquiring lock…";
const LABEL_RELEASING = "Releasing lock…";

const ERROR_LABELS: Record<string, string> = {
  [LABEL_UPLOADING]: "Upload failed",
  [LABEL_SYNCING]: "Sync failed",
  [LABEL_ACQUIRING]: "Lock failed",
  [LABEL_RELEASING]: "Release failed",
};

/** Error label for a failed active label (falls back to a generic form). */
export function errorLabelForActiveLabel(activeLabel: string): string {
  const mapped = ERROR_LABELS[activeLabel];
  if (mapped !== undefined) return mapped;
  const stripped = activeLabel.replace(/…+$/, "").trim();
  return stripped === "" ? "Request failed" : `${stripped} failed`;
}

function requestUrlAndMethod(
  input: RequestInfo | URL,
  init?: RequestInit,
): { url: string; method: string } {
  if (typeof input === "string") {
    return { url: input, method: (init?.method ?? "GET").toUpperCase() };
  }
  if (input instanceof URL) {
    return { url: input.href, method: (init?.method ?? "GET").toUpperCase() };
  }
  const method = init?.method ?? input.method;
  return { url: input.url, method: method.toUpperCase() };
}

function hasPathSegment(
  url: string,
  segment: "/lock" | "/release" | "/heartbeat" | "/state",
): boolean {
  // Matches the segment at the end of the path (before ?/# or end).
  const q = url.split("?")[0]?.split("#")[0] ?? url;
  return (
    q.endsWith(segment) ||
    q.includes(`${segment}?`) ||
    q.includes(`${segment}#`)
  );
}

/**
 * Active label for a request, or null when it is background noise that must
 * never light the widget (lock poll, heartbeat, /api/version, unknown).
 */
export function labelForRequest(url: string, method: string): string | null {
  const upper = method.toUpperCase();
  if (url.includes("/api/version")) return null;
  if (upper === "POST" && hasPathSegment(url, "/heartbeat")) return null;
  if (upper === "GET" && hasPathSegment(url, "/state")) return null;

  if (upper === "PUT" && url.includes("/files")) return LABEL_UPLOADING;
  if (upper === "GET" && url.includes("/api/vfs")) return LABEL_SYNCING;
  if (upper === "POST" && hasPathSegment(url, "/lock")) return LABEL_ACQUIRING;
  if (upper === "POST" && hasPathSegment(url, "/release"))
    return LABEL_RELEASING;
  return null;
}

/** Snapshot the widget renders from (plain data, no Svelte dependency). */
export interface NetActivitySnapshot {
  /** Tracked requests currently in flight. */
  count: number;
  /** Active label (last started), or the final label while fading. */
  label: string | null;
  /** Error label when the last settle was a failure, else null. */
  error: string | null;
  /** True once the delay elapsed (or on error) until the fade completes. */
  visible: boolean;
  /** True while the settled label is fading out. */
  fading: boolean;
}

function prefersReducedMotion(): boolean {
  return (
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Pure activity tracker. Pair with `wrap(inner)` for a fetch-compatible
 * wrapper, or drive directly via `track(url, method, task)` in tests.
 */
export class NetActivityTracker {
  count = 0;
  label: string | null = null;
  error: string | null = null;
  visible = false;
  fading = false;

  private showTimer: ReturnType<typeof setTimeout> | null = null;
  private fadeTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  snapshot(): NetActivitySnapshot {
    return {
      count: this.count,
      label: this.label,
      error: this.error,
      visible: this.visible,
      fading: this.fading,
    };
  }

  reset(): void {
    if (this.showTimer !== null) {
      clearTimeout(this.showTimer);
      this.showTimer = null;
    }
    if (this.fadeTimer !== null) {
      clearTimeout(this.fadeTimer);
      this.fadeTimer = null;
    }
    this.count = 0;
    this.label = null;
    this.error = null;
    this.visible = false;
    this.fading = false;
    this.emit();
  }

  /** Fetch-compatible wrapper around `inner` sharing this tracker's state. */
  wrap(inner: FetchLike): FetchLike {
    return (input, init) => {
      const { url, method } = requestUrlAndMethod(input, init);
      return this.track(url, method, () => inner(input, init));
    };
  }

  async track<T>(
    url: string,
    method: string,
    task: () => Promise<T>,
  ): Promise<T> {
    const label = labelForRequest(url, method);
    if (label === null) return task();

    this.count += 1;
    this.label = label;
    this.error = null;
    if (this.fadeTimer !== null) {
      clearTimeout(this.fadeTimer);
      this.fadeTimer = null;
    }
    this.fading = false;
    if (!this.visible && this.showTimer === null) {
      this.showTimer = setTimeout(() => {
        this.showTimer = null;
        if (this.count > 0) {
          this.visible = true;
          this.emit();
        }
      }, ACTIVITY_INDICATOR_DELAY_MS);
    }
    this.emit();
    try {
      const result = await task();
      this.settle(false, label);
      return result;
    } catch (error) {
      this.settle(true, label);
      throw error;
    }
  }

  private settle(isError: boolean, label: string): void {
    this.count = Math.max(0, this.count - 1);
    if (this.count > 0) {
      if (isError) {
        if (this.showTimer !== null) {
          clearTimeout(this.showTimer);
          this.showTimer = null;
        }
        this.error = errorLabelForActiveLabel(label);
        this.visible = true;
      }
      this.emit();
      return;
    }
    if (isError) {
      if (this.showTimer !== null) {
        clearTimeout(this.showTimer);
        this.showTimer = null;
      }
      this.error = errorLabelForActiveLabel(label);
      this.label = label;
      this.visible = true;
      this.fading = true;
      this.emit();
      this.beginFade();
      return;
    }
    if (!this.visible) {
      if (this.showTimer !== null) {
        clearTimeout(this.showTimer);
        this.showTimer = null;
      }
      this.label = null;
      this.error = null;
      this.fading = false;
      this.emit();
      return;
    }
    this.fading = true;
    this.emit();
    this.beginFade();
  }

  private beginFade(): void {
    if (this.fadeTimer !== null) {
      clearTimeout(this.fadeTimer);
      this.fadeTimer = null;
    }
    if (prefersReducedMotion()) {
      this.visible = false;
      this.fading = false;
      this.label = null;
      this.error = null;
      this.emit();
      return;
    }
    this.fadeTimer = setTimeout(() => {
      this.fadeTimer = null;
      if (this.count === 0) {
        this.visible = false;
        this.fading = false;
        this.label = null;
        this.error = null;
        this.emit();
      }
    }, ACTIVITY_FADE_OUT_MS);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

/** App-wide tracker: every wrapped call site reports to the same widget. */
export const netActivity = new NetActivityTracker();

/** Shared wrapped transport (uses the live `globalThis.fetch` per call). */
export const trackedFetch: FetchLike = (input, init) => {
  const { url, method } = requestUrlAndMethod(input, init);
  return netActivity.track(url, method, () => globalThis.fetch(input, init));
};
