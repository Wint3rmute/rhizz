// HTTP-specific behavior of ServerProjectStore: what it sends to the
// server, how it reacts to failures, and how it treats server responses —
// the storage-agnostic behavioral suite lives in store.contract.test.ts.
import { describe, expect, it } from "vitest";
import { ServerProjectStore } from "./serverStore";

interface FakeFetchOptions {
  /** In-memory blob the fake server serves; undefined = empty VFS. */
  blob?: unknown;
  /** Response status for VFS endpoints (default 200 GET / 204 PUT). */
  status?: number;
  /** Reject every request instead of responding. */
  networkDown?: boolean;
}

interface FakeServerFetch {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  calls: { method: string; url: string; body: string | null }[];
}

// A fake rhizz-server standing in for fetch: serves one in-memory blob
// with GET/PUT /api/vfs semantics and records every call it receives.
function makeFakeFetch(options: FakeFetchOptions = {}): FakeServerFetch {
  const calls: { method: string; url: string; body: string | null }[] = [];
  let blob: unknown = options.blob;
  const fetchImpl = (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.href
      : input.url;
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? init.body : null;
    calls.push({ method, url, body });
    if (options.networkDown) {
      return Promise.reject(new TypeError("network down"));
    }
    if (!url.endsWith("/api/vfs")) {
      return Promise.resolve(new Response("not found", { status: 404 }));
    }
    if (method === "PUT") {
      if (options.status !== undefined && options.status !== 204) {
        return Promise.resolve(
          new Response("save failed", { status: options.status }),
        );
      }
      blob = JSON.parse(body ?? "{}");
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (options.status !== undefined && options.status !== 200) {
      return Promise.resolve(
        new Response("load failed", { status: options.status }),
      );
    }
    return Promise.resolve(
      new Response(
        JSON.stringify(blob ?? { version: 1, projects: [], nodes: [] }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
  };
  return { fetch: fetchImpl, calls };
}

describe("ServerProjectStore HTTP behavior", () => {
  it("fetches before a mutation and dumps the whole VFS on save", async () => {
    const fake = makeFakeFetch();
    const store = new ServerProjectStore("http://rhizz-server", {
      fetch: fake.fetch,
    });
    await store.createProject("drone");
    expect(fake.calls.map((c) => c.method)).toEqual(["GET", "PUT"]);
    expect(fake.calls[0]?.url).toBe("http://rhizz-server/api/vfs");

    const putBody = JSON.parse(fake.calls[1]?.body ?? "{}") as {
      version: number;
      projects: { id: string; name: string }[];
      nodes: unknown[];
    };
    expect(putBody.version).toBe(1);
    expect(putBody.projects[0]?.name).toBe("drone");
    expect(putBody.nodes).toEqual([]);
  });

  it("strips trailing slashes from the base url", async () => {
    const fake = makeFakeFetch();
    const store = new ServerProjectStore("http://rhizz-server///", {
      fetch: fake.fetch,
    });
    await store.listProjects();
    expect(fake.calls[0]?.url).toBe("http://rhizz-server/api/vfs");
  });

  it("rejects when the server is unreachable", async () => {
    const store = new ServerProjectStore("http://rhizz-server", {
      fetch: makeFakeFetch({ networkDown: true }).fetch,
    });
    await expect(store.listProjects()).rejects.toThrow("network down");
    await expect(store.createProject("x")).rejects.toThrow("network down");
  });

  it("rejects on a non-ok load response", async () => {
    const store = new ServerProjectStore("http://rhizz-server", {
      fetch: makeFakeFetch({ status: 500 }).fetch,
    });
    await expect(store.listProjects()).rejects.toThrow(/500/);
  });

  it("rejects on a non-ok save response", async () => {
    const store = new ServerProjectStore("http://rhizz-server", {
      fetch: makeFakeFetch({ status: 500 }).fetch,
    });
    await expect(store.createProject("x")).rejects.toThrow(/500/);
  });

  it("persists across store instances via the same server blob", async () => {
    // Two stores sharing one fake fetch share the fake server's blob,
    // just like two browser tabs would share the real server's data dir.
    const fake = makeFakeFetch();
    const first = new ServerProjectStore("http://rhizz-server", {
      fetch: fake.fetch,
      now: () => "t0",
    });
    await first.createProject("drone");
    const [project] = await first.listProjects();
    await first.createFile(
      project?.id ?? "",
      null,
      "system.hcl",
      "component a {}",
    );

    const second = new ServerProjectStore("http://rhizz-server", {
      fetch: fake.fetch,
    });
    const projects = await second.listProjects();
    expect(projects.map((p) => p.name)).toEqual(["drone"]);
    const nodes = await second.listNodes(projects[0]?.id ?? "");
    expect(nodes.map((n) => n.name)).toEqual(["system.hcl"]);
  });

  it("forgivingly drops malformed entries returned by the server", async () => {
    const blob = {
      version: 1,
      projects: [
        { id: "ok", name: "Good", createdAt: "t0", updatedAt: "t1" },
        { id: 42, name: "Bad" },
      ],
      nodes: [
        {
          id: "n1",
          projectId: "ok",
          parentId: null,
          name: "a.hcl",
          kind: "file",
        },
      ],
    };
    const store = new ServerProjectStore("http://rhizz-server", {
      fetch: makeFakeFetch({ blob }).fetch,
    });
    const projects = await store.listProjects();
    expect(projects.map((p) => p.id)).toEqual(["ok"]);
  });
});
