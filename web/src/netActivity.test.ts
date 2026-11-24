import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACTIVITY_FADE_OUT_MS,
  ACTIVITY_INDICATOR_DELAY_MS,
  errorLabelForActiveLabel,
  labelForRequest,
  NetActivityTracker,
} from "./netActivity";

function okResponse(): Response {
  return new Response("{}", {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function deferred<T = Response>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("labelForRequest", () => {
  it("maps tracked endpoints to labels", () => {
    expect(labelForRequest("https://x/api/projects/d/files", "PUT")).toBe(
      "Uploading…",
    );
    expect(labelForRequest("https://x/api/vfs", "GET")).toBe("Syncing…");
    expect(labelForRequest("https://x/api/projects/d/lock", "POST")).toBe(
      "Acquiring lock…",
    );
    expect(labelForRequest("https://x/api/projects/d/release", "POST")).toBe(
      "Releasing lock…",
    );
  });

  it("ignores background noise and unknown endpoints", () => {
    expect(labelForRequest("https://x/api/projects/d/state", "GET")).toBeNull();
    expect(
      labelForRequest("https://x/api/projects/d/heartbeat", "POST"),
    ).toBeNull();
    expect(labelForRequest("https://x/api/version", "GET")).toBeNull();
    expect(labelForRequest("https://x/api/projects/d/files", "GET")).toBeNull();
    expect(labelForRequest("https://x/api/unknown", "GET")).toBeNull();
    expect(labelForRequest("", "GET")).toBeNull();
  });
});

describe("errorLabelForActiveLabel", () => {
  it("maps active labels to error labels", () => {
    expect(errorLabelForActiveLabel("Uploading…")).toBe("Upload failed");
    expect(errorLabelForActiveLabel("Syncing…")).toBe("Sync failed");
    expect(errorLabelForActiveLabel("Acquiring lock…")).toBe("Lock failed");
    expect(errorLabelForActiveLabel("Releasing lock…")).toBe("Release failed");
  });

  it("falls back without corrupting unknown labels", () => {
    expect(errorLabelForActiveLabel("Weird…")).toBe("Weird failed");
    expect(errorLabelForActiveLabel("")).toBe("Request failed");
  });
});

describe("NetActivityTracker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps fast localhost ops from flickering", async () => {
    const tracker = new NetActivityTracker();
    const task = tracker.track("https://x/api/vfs", "GET", () =>
      Promise.resolve(okResponse()),
    );
    // Settles well before the 300ms threshold.
    await task;
    expect(tracker.snapshot()).toMatchObject({
      count: 0,
      visible: false,
      fading: false,
      label: null,
    });
    await vi.advanceTimersByTimeAsync(ACTIVITY_INDICATOR_DELAY_MS + 100);
    expect(tracker.visible).toBe(false);
  });

  it("shows the label only after the delay, then fades it out", async () => {
    const tracker = new NetActivityTracker();
    const gate = deferred();
    const task = tracker.track("https://x/api/vfs", "GET", () => gate.promise);
    expect(tracker.count).toBe(1);
    expect(tracker.label).toBe("Syncing…");
    expect(tracker.visible).toBe(false);

    await vi.advanceTimersByTimeAsync(ACTIVITY_INDICATOR_DELAY_MS - 1);
    expect(tracker.visible).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(tracker.visible).toBe(true);

    gate.resolve(okResponse());
    await task;
    expect(tracker.snapshot()).toMatchObject({
      count: 0,
      visible: true,
      fading: true,
      label: "Syncing…",
    });
    await vi.advanceTimersByTimeAsync(ACTIVITY_FADE_OUT_MS - 1);
    expect(tracker.visible).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(tracker.snapshot()).toMatchObject({
      visible: false,
      fading: false,
      label: null,
    });
  });

  it("cancels the fade when a new request starts", async () => {
    const tracker = new NetActivityTracker();
    const first = deferred();
    const task = tracker.track("https://x/api/vfs", "GET", () => first.promise);
    await vi.advanceTimersByTimeAsync(ACTIVITY_INDICATOR_DELAY_MS);
    expect(tracker.visible).toBe(true);
    first.resolve(okResponse());
    await task;
    expect(tracker.fading).toBe(true);

    // Halfway through the fade a new upload starts: the fade is dropped.
    await vi.advanceTimersByTimeAsync(100);
    const second = deferred();
    const next = tracker.track(
      "https://x/api/projects/d/files",
      "PUT",
      () => second.promise,
    );
    expect(tracker.fading).toBe(false);
    expect(tracker.visible).toBe(true);
    expect(tracker.label).toBe("Uploading…");

    // The old fade timer must not hide the new request.
    await vi.advanceTimersByTimeAsync(ACTIVITY_FADE_OUT_MS);
    expect(tracker.visible).toBe(true);
    second.resolve(okResponse());
    await next;
    await vi.advanceTimersByTimeAsync(ACTIVITY_FADE_OUT_MS);
    expect(tracker.visible).toBe(false);
  });

  it("shows failed tracked requests immediately with an error style", async () => {
    const tracker = new NetActivityTracker();
    const task = tracker
      .track("https://x/api/vfs", "GET", () =>
        Promise.reject(new TypeError("network down")),
      )
      .catch(() => undefined);
    await task;
    // Errors bypass the 300ms threshold so outages are visible.
    expect(tracker.snapshot()).toMatchObject({
      count: 0,
      visible: true,
      fading: true,
      error: "Sync failed",
    });
    await vi.advanceTimersByTimeAsync(ACTIVITY_FADE_OUT_MS);
    expect(tracker.snapshot()).toMatchObject({
      visible: false,
      error: null,
    });
  });

  it("leaves background noise untracked", async () => {
    const tracker = new NetActivityTracker();
    let called = 0;
    await tracker.track("https://x/api/projects/d/state", "GET", () => {
      called += 1;
      return Promise.resolve(okResponse());
    });
    await tracker.track("https://x/api/projects/d/heartbeat", "POST", () => {
      called += 1;
      return Promise.resolve(okResponse());
    });
    await tracker.track("https://x/api/version", "GET", () => {
      called += 1;
      return Promise.resolve(okResponse());
    });
    expect(called).toBe(3);
    expect(tracker.snapshot()).toMatchObject({ count: 0, visible: false });
    await vi.advanceTimersByTimeAsync(
      ACTIVITY_INDICATOR_DELAY_MS + ACTIVITY_FADE_OUT_MS,
    );
    expect(tracker.visible).toBe(false);
  });

  it("wraps a fetch impl without changing its behavior", async () => {
    const tracker = new NetActivityTracker();
    const calls: string[] = [];
    const inner = (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === "string" ? input : (input as Request).url;
      calls.push(url);
      if (url.includes("/api/vfs")) {
        return Promise.reject(new TypeError("offline"));
      }
      return Promise.resolve(okResponse());
    };
    const fetch = tracker.wrap(inner);
    await expect(
      fetch("https://x/api/other").then((r) => r.status),
    ).resolves.toBe(200);
    expect(tracker.visible).toBe(false);
    await expect(fetch("https://x/api/vfs")).rejects.toThrow(/offline/);
    expect(tracker.error).toBe("Sync failed");
    expect(calls).toEqual(["https://x/api/other", "https://x/api/vfs"]);
  });

  it("hides instantly under prefers-reduced-motion", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const tracker = new NetActivityTracker();
    const gate = deferred();
    const task = tracker.track("https://x/api/vfs", "GET", () => gate.promise);
    await vi.advanceTimersByTimeAsync(ACTIVITY_INDICATOR_DELAY_MS);
    expect(tracker.visible).toBe(true);
    gate.resolve(okResponse());
    await task;
    expect(tracker.snapshot()).toMatchObject({ visible: false, label: null });
  });
});
