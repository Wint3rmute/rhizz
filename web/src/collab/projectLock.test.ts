// Protocol tests for the lock client: polling transitions, heartbeat
// renewal, and loss — all against a fake server, no network.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LOCK_HEARTBEAT_MS,
  LOCK_POLL_MS,
  ProjectLock,
} from "./projectLock.svelte";

interface FakeServer {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  calls: { method: string; url: string; user: string | null }[];
  state: { version: string; lockedBy: string | null };
}

function makeFakeServer(): FakeServer {
  const calls: FakeServer["calls"] = [];
  const state = { version: "v1", lockedBy: null as string | null };
  const fetch = (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    calls.push({ method, url, user: headers.get("x-rhizz-user") });
    if (url.endsWith("/state")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            version: state.version,
            lockedBy: state.lockedBy,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    }
    if (url.endsWith("/heartbeat")) {
      const user = headers.get("x-rhizz-user");
      if (state.lockedBy !== null && state.lockedBy !== user) {
        return Promise.resolve(new Response("conflict", { status: 409 }));
      }
      state.lockedBy = user;
      return Promise.resolve(
        new Response(JSON.stringify({ lockedBy: user }), { status: 200 }),
      );
    }
    return Promise.resolve(new Response("not found", { status: 404 }));
  };
  return { fetch, calls, state };
}

describe("ProjectLock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stays lock-free without a server backend", async () => {
    const lock = new ProjectLock();
    lock.me = "alice";
    lock.start("drone", null);
    await vi.advanceTimersByTimeAsync(LOCK_POLL_MS * 3);
    expect(lock.active).toBe(false);
    expect(lock.readonly).toBe(false);
    expect(lock.version).toBeNull();
    lock.stop();
  });

  it("polls the state and derives readonly for foreign holders", async () => {
    const fake = makeFakeServer();
    const lock = new ProjectLock();
    lock.me = "alice";
    lock.start("drone", "http://server", fake.fetch);
    await vi.advanceTimersByTimeAsync(0);
    expect(lock.version).toBe("v1");
    expect(lock.readonly).toBe(false);

    fake.state.lockedBy = "bob";
    await vi.advanceTimersByTimeAsync(LOCK_POLL_MS);
    expect(lock.lockedBy).toBe("bob");
    expect(lock.readonly).toBe(true);
    expect(lock.holding).toBe(false);

    fake.state.lockedBy = "alice";
    await vi.advanceTimersByTimeAsync(LOCK_POLL_MS);
    expect(lock.readonly).toBe(false);
    expect(lock.holding).toBe(true);
    lock.stop();
  });

  it("heartbeats while holding and stops once someone else holds it", async () => {
    const fake = makeFakeServer();
    fake.state.lockedBy = "alice";
    const lock = new ProjectLock();
    lock.me = "alice";
    lock.start("drone", "http://server", fake.fetch);
    await vi.advanceTimersByTimeAsync(0);
    expect(lock.holding).toBe(true);

    const heartbeats = () =>
      fake.calls.filter((c) => c.url.endsWith("/heartbeat"));
    await vi.advanceTimersByTimeAsync(LOCK_HEARTBEAT_MS);
    expect(heartbeats()).toHaveLength(1);
    expect(heartbeats()[0]?.user).toBe("alice");

    // Someone else takes it: the next poll flips the badge, and with
    // `holding` false no further heartbeat goes out.
    fake.state.lockedBy = "bob";
    await vi.advanceTimersByTimeAsync(LOCK_POLL_MS);
    expect(lock.lockedBy).toBe("bob");
    expect(lock.readonly).toBe(true);
    await vi.advanceTimersByTimeAsync(LOCK_HEARTBEAT_MS * 2);
    expect(heartbeats()).toHaveLength(1);
    lock.stop();
  });

  it("does not heartbeat when someone else holds the lock", async () => {
    const fake = makeFakeServer();
    fake.state.lockedBy = "bob";
    const lock = new ProjectLock();
    lock.me = "alice";
    lock.start("drone", "http://server", fake.fetch);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(LOCK_HEARTBEAT_MS * 2);
    expect(fake.calls.filter((c) => c.url.endsWith("/heartbeat"))).toEqual([]);
    lock.stop();
  });

  it("stop clears the state and the timers", async () => {
    const fake = makeFakeServer();
    const lock = new ProjectLock();
    lock.me = "alice";
    lock.start("drone", "http://server", fake.fetch);
    await vi.advanceTimersByTimeAsync(0);
    expect(lock.version).toBe("v1");
    lock.stop();
    expect(lock.active).toBe(false);
    expect(lock.version).toBeNull();
    expect(lock.lockedBy).toBeNull();
    const calls = fake.calls.length;
    await vi.advanceTimersByTimeAsync(LOCK_POLL_MS * 3);
    expect(fake.calls).toHaveLength(calls);
  });
});
