import { afterEach, describe, expect, it } from "vitest";
import {
  forgetLastView,
  readLastView,
  rememberLastView,
  resolveViewToOpen,
} from "./lastView";

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
  return data;
}

afterEach(() => {
  // Bare node has no localStorage; restore that between tests.
  Reflect.deleteProperty(globalThis, "localStorage");
});

describe("lastView storage", () => {
  it("is empty when nothing was remembered", () => {
    stubStore();
    expect(readLastView("project-a")).toBeNull();
  });

  it("round-trips a remembered view for its own project", () => {
    stubStore();
    rememberLastView("project-a", "drone/airframe.hcl");
    expect(readLastView("project-a")).toBe("drone/airframe.hcl");
  });

  it("keeps projects apart", () => {
    stubStore();
    rememberLastView("project-a", "main.hcl");
    expect(readLastView("project-b")).toBeNull();
  });

  it("rejects garbage instead of handing it back", () => {
    const data = stubStore();
    data.set("rhizz-last-view:project-a", "{not json");
    expect(readLastView("project-a")).toBeNull();
    data.set("rhizz-last-view:project-a", JSON.stringify(42));
    expect(readLastView("project-a")).toBeNull();
  });

  it("stays quiet without any storage", () => {
    expect(readLastView("project-a")).toBeNull();
    expect(() => {
      rememberLastView("project-a", "main.hcl");
    }).not.toThrow();
  });

  it("forgets a remembered view", () => {
    stubStore();
    rememberLastView("project-a", "main.hcl");
    forgetLastView("project-a");
    expect(readLastView("project-a")).toBeNull();
  });

  it("forgetting stays quiet without any storage", () => {
    expect(() => {
      forgetLastView("project-a");
    }).not.toThrow();
  });
});

describe("resolveViewToOpen", () => {
  it("prefers the requested view (deep link, back/forward)", () => {
    expect(
      resolveViewToOpen({
        requested: "main.hcl",
        remembered: "other.hcl",
        open: "other.hcl",
        first: "main.hcl",
        exists: () => true,
      }),
    ).toBe("main.hcl");
  });

  it("falls back to the remembered view when nothing is requested", () => {
    expect(
      resolveViewToOpen({
        requested: "",
        remembered: "other.hcl",
        open: null,
        first: "main.hcl",
        exists: () => true,
      }),
    ).toBe("other.hcl");
  });

  it("ignores a remembered view that no longer exists", () => {
    expect(
      resolveViewToOpen({
        requested: "",
        remembered: "deleted.hcl",
        open: null,
        first: "main.hcl",
        exists: (path) => path === "main.hcl",
      }),
    ).toBe("main.hcl");
  });

  it("keeps the open view when neither request nor memory applies", () => {
    expect(
      resolveViewToOpen({
        requested: "",
        remembered: null,
        open: "other.hcl",
        first: "main.hcl",
        exists: () => true,
      }),
    ).toBe("other.hcl");
  });

  it("opens the first view when nothing else applies", () => {
    expect(
      resolveViewToOpen({
        requested: "",
        remembered: null,
        open: null,
        first: "main.hcl",
        exists: () => true,
      }),
    ).toBe("main.hcl");
  });

  it("opens nothing when the project has no views at all", () => {
    expect(
      resolveViewToOpen({
        requested: "",
        remembered: null,
        open: null,
        first: null,
        exists: () => true,
      }),
    ).toBeNull();
  });
});
