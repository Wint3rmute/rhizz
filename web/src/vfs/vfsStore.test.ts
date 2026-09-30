// HTTP-backend-specific behavior: what it sends to the server, how it reacts
// to failures, and how it treats server responses — the storage-agnostic
// behavioral suite lives in store.contract.test.ts, the session read cache's
// own behavior (how often the backend is actually touched) is in the
// "VfsProjectStore read cache" suite at the bottom of this file, and the
// create/delete console announcements are in the suite after it.
import { describe, expect, it, vi } from "vitest";
import {
  memoryBackend,
  ServerProjectStore,
  type VfsBackend,
  VfsProjectStore,
} from "./vfsStore";
import { openProjectFs } from "./fs";
import { readProjectSources } from "./compile";
import type { VfsData } from "./operations";
import { emptyVfsData } from "./operations";

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

  it("keeps one project when a loaded blob has two at the same address", async () => {
    // A hand-edited or half-migrated blob can hold two projects whose id (the
    // address) is the same. Refusing the whole blob would brick the app, so
    // the later one is dropped with a warning — the store can never produce
    // such a blob, this is purely about reading a broken one.
    const fake = makeFakeFetch({
      blob: {
        version: 1,
        projects: [
          {
            id: "drone-system",
            name: "Drone System",
            createdAt: "2024-01-01T00:00:00Z",
            updatedAt: "2024-01-01T00:00:00Z",
          },
          {
            id: "drone-system",
            name: "drone system!",
            createdAt: "2024-01-02T00:00:00Z",
            updatedAt: "2024-01-02T00:00:00Z",
          },
        ],
        nodes: [],
      },
    });
    const store = new ServerProjectStore("http://rhizz-server", {
      fetch: fake.fetch,
    });
    expect((await store.listProjects()).map((p) => p.name)).toEqual([
      "Drone System",
    ]);
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

describe("VfsProjectStore read cache", () => {
  // The store hands every backend the *whole* VFS on every call, so a
  // read-mostly workload — the modeling editor reads the project's files on
  // open, then again on every view switch, and the file facade calls
  // listNodes once per readdir/readFile/stat — pays for one full transfer
  // per filesystem call. These tests pin how often the backend is reached
  // for real; "what the store does with the data" is store.contract.test.ts's
  // job.
  interface CountingBackend {
    backend: VfsBackend;
    reads: () => number;
    writes: () => number;
    setFailingWrites: (failing: boolean) => void;
  }

  function makeCountingBackend(): CountingBackend {
    let data: VfsData = emptyVfsData();
    let reads = 0;
    let writes = 0;
    let failingWrites = false;
    return {
      backend: {
        read: () => {
          reads += 1;
          return Promise.resolve(data);
        },
        write: (next) => {
          writes += 1;
          if (failingWrites) return Promise.reject(new Error("disk full"));
          data = next;
          return Promise.resolve();
        },
      },
      reads: () => reads,
      writes: () => writes,
      setFailingWrites: (failing) => {
        failingWrites = failing;
      },
    };
  }

  // A deterministic clock, so revision/updatedAt assertions never depend on
  // wall-clock resolution.
  function makeStore(backend: VfsBackend): VfsProjectStore {
    let tick = 0;
    return new VfsProjectStore(backend, () => `t${String(tick++)}`);
  }

  it("reads the backend once, however many reads follow", async () => {
    const counting = makeCountingBackend();
    const store = makeStore(counting.backend);
    const project = await store.createProject("drone");
    // The create read the backend once (nothing was cached yet) and wrote
    // the result back; everything after it must be free.
    expect(counting.reads()).toBe(1);
    expect(counting.writes()).toBe(1);

    await store.listProjects();
    await store.listNodes(project.id);
    await store.listProjects();

    expect(counting.reads()).toBe(1);
    expect(counting.writes()).toBe(1);
  });

  it("coalesces reads that start before the first one has landed", async () => {
    // readProjectSources fans one readFile out per project file, all at
    // once, on a page that has not read anything yet — without
    // single-flight, every one of them would miss the cache and fetch.
    const counting = makeCountingBackend();
    const store = makeStore(counting.backend);
    const project = await store.createProject("drone");
    const readsBefore = counting.reads();

    await Promise.all([
      store.listNodes(project.id),
      store.listNodes(project.id),
      store.listProjects(),
    ]);

    expect(counting.reads()).toBe(readsBefore);
  });

  it("serves a mutation's result to later reads without reaching the backend", async () => {
    const counting = makeCountingBackend();
    const store = makeStore(counting.backend);
    const project = await store.createProject("drone");
    const file = await store.createFile(
      project.id,
      null,
      "system.hcl",
      'system "drone" {}',
    );
    expect(counting.reads()).toBe(1);
    expect(counting.writes()).toBe(2);

    const [node] = await store.listNodes(project.id);
    expect(node?.id).toBe(file.id);
    expect(counting.reads()).toBe(1);
  });

  it("keeps both writes when two mutations overlap", async () => {
    // Without ordering, both mutations derive from the same snapshot and
    // the second save erases the first one's file.
    const counting = makeCountingBackend();
    const store = makeStore(counting.backend);
    const project = await store.createProject("p");

    await Promise.all([
      store.createFile(project.id, null, "a.hcl", ""),
      store.createFile(project.id, null, "b.hcl", ""),
    ]);

    const names = (await store.listNodes(project.id)).map((n) => n.name)
      .toSorted();
    expect(names).toEqual(["a.hcl", "b.hcl"]);
  });

  it("re-reads from the backend after a save that failed", async () => {
    // The cache would otherwise keep state the backend never accepted.
    const counting = makeCountingBackend();
    const store = makeStore(counting.backend);
    const project = await store.createProject("drone");
    const readsBefore = counting.reads();

    counting.setFailingWrites(true);
    await expect(
      store.createFile(project.id, null, "a.hcl", ""),
    ).rejects.toThrow("disk full");
    counting.setFailingWrites(false);

    await store.listProjects();
    expect(counting.reads()).toBe(readsBefore + 1);
  });

  it("reads a project's sources through the file facade in one pass", async () => {
    // The page-open path: mkdir, two writes, then readProjectSources — which
    // is a readdir plus one readFile per source file.
    const counting = makeCountingBackend();
    const store = makeStore(counting.backend);
    const project = await store.createProject("drone");
    const fs = openProjectFs(store, project.id);
    await fs.mkdir("docs", { recursive: true });
    await fs.writeFile("main.hcl", 'system "drone" {}');
    await fs.writeFile("docs/motor.md", "# motor");
    const readsBefore = counting.reads();

    const sources = await readProjectSources(fs);

    expect(sources.map((s) => s.filename).toSorted()).toEqual([
      "docs/motor.md",
      "main.hcl",
    ]);
    expect(counting.reads()).toBe(readsBefore);
  });

  it("starts empty in a new store, so a reload re-reads the backend", async () => {
    // The cache is per store instance and never persisted: a page reload
    // builds a new one, which is the only invalidation this design has.
    const counting = makeCountingBackend();
    const first = makeStore(counting.backend);
    const project = await first.createProject("drone");
    await first.createFile(project.id, null, "a.hcl", "");

    const second = makeStore(counting.backend);
    expect((await second.listNodes(project.id)).map((n) => n.name)).toEqual([
      "a.hcl",
    ]);
    expect(counting.reads()).toBe(2);
  });
});

describe("VfsProjectStore lifecycle logging", () => {
  // Creating and deleting a project are the two moments worth seeing in the
  // browser console, and the store is where every backend and every caller
  // (the /projects page, the navbar's tour flow, Storybook's seeds) funnels
  // through — so one line here covers all of them. Each message carries the
  // name *and* the id, because the id is the project's address (the slug in
  // /projects/<id>/…), which is what a reader needs to find it again.

  // Captures console.log for the duration of one test and returns the lines a
  // developer would have seen. Set up per test rather than once for the suite
  // so the real console is untouched for every other test in this file.
  async function captureLogs(run: () => Promise<void>): Promise<string[]> {
    const lines: string[] = [];
    const spy = vi
      .spyOn(console, "log")
      .mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(" "));
      });
    try {
      await run();
    } finally {
      spy.mockRestore();
    }
    return lines;
  }

  it("logs the name and address of a created project", async () => {
    const store = new VfsProjectStore(memoryBackend(), () => "t0");
    const lines = await captureLogs(async () => {
      await store.createProject("Drone System");
    });
    expect(lines).toEqual([
      'VfsProjectStore: created project "Drone System" (drone-system)',
    ]);
  });

  it("logs the name and address of a deleted project", async () => {
    const store = new VfsProjectStore(memoryBackend(), () => "t0");
    // Created outside the capture, so the assertion below is exactly the one
    // delete line and not the create line before it.
    const project = await store.createProject("Drone System");
    const lines = await captureLogs(async () => {
      await store.deleteProject(project.id);
    });
    expect(lines).toEqual([
      'VfsProjectStore: deleted project "Drone System" (drone-system)',
    ]);
  });

  it("logs nothing when the store refuses the operation", async () => {
    // A refusal is not a lifecycle event: a line saying "created" or "deleted"
    // for work that never happened is the one thing this log must not print.
    const store = new VfsProjectStore(memoryBackend(), () => "t0");
    await store.createProject("Drone System");
    const lines = await captureLogs(async () => {
      await expect(store.createProject("Drone System")).rejects.toThrow();
      await expect(store.deleteProject("does-not-exist")).rejects.toThrow();
    });
    expect(lines).toEqual([]);
  });

  it("logs nothing when the backend rejects the write", async () => {
    // The mutation itself succeeded — the data was built and the cache already
    // holds it — but nothing was persisted, so the project does not exist.
    // This is why the log waits for the write to settle rather than sitting
    // next to ops.createProject, where it would have already fired.
    const failing: VfsBackend = {
      read: () => Promise.resolve(emptyVfsData()),
      write: () => Promise.reject(new Error("disk full")),
    };
    const store = new VfsProjectStore(failing, () => "t0");
    const lines = await captureLogs(async () => {
      await expect(store.createProject("Drone System")).rejects.toThrow(
        "disk full",
      );
    });
    expect(lines).toEqual([]);
  });
});
