import { afterEach, describe, expect, it } from "vitest";
import {
  consumePendingTourStart,
  getTourRequest,
  pendTourStart,
  requestTourStart,
} from "./tourRequest.svelte";

describe("tourRequest", () => {
  it("bumps the generation and carries the target project", () => {
    const before = getTourRequest().generation;
    requestTourStart("project-a");
    const after = getTourRequest();
    expect(after.generation).toBe(before + 1);
    expect(after.projectId).toBe("project-a");
  });

  it("defaults to a project-less request", () => {
    requestTourStart();
    expect(getTourRequest().projectId).toBeNull();
  });
});

describe("pending tour start", () => {
  function stubStore() {
    const data = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => {
          data.set(key, value);
        },
        removeItem: (key: string) => {
          data.delete(key);
        },
      },
      writable: true,
      configurable: true,
    });
  }

  afterEach(() => {
    // Bare node has no localStorage; restore that between tests.
    Reflect.deleteProperty(globalThis, "localStorage");
  });

  it("is empty when nothing was pended", () => {
    stubStore();
    expect(consumePendingTourStart()).toBe(false);
  });

  it("round-trips pend -> consume exactly once", () => {
    stubStore();
    pendTourStart();
    expect(consumePendingTourStart()).toBe(true);
    expect(consumePendingTourStart()).toBe(false);
  });

  it("stays quiet without any storage", () => {
    expect(consumePendingTourStart()).toBe(false);
  });
});
