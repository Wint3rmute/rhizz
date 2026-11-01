// HTTP-backend-specific behavior: what it sends to the server, how it reacts
// to failures, and how it treats server responses — the storage-agnostic
// behavioral suite lives in store.contract.test.ts, the session read cache's
// own behavior (how often the backend is actually touched) is in the
// "VfsProjectStore read cache" suite at the bottom of this file, and the
// create/delete console announcements are in the suite after it.
import { describe, expect, it, vi } from "vitest";
import {
  LocalStorageProjectStore,
  memoryBackend,
  ServerProjectStore,
  type VfsBackend,
  VfsProjectStore,
} from "./vfsStore";
import { openProjectFs } from "./fs";
import { readProjectSources } from "./compile";
import { emptyVfsData, type VfsData } from "./operations";

interface FakeServerFetchOptions {
  /** In-memory projects the fake server holds, keyed by project id. */
  blob?: unknown;
  /** Response status for failing endpoints (must be >= 400 to take effect). */
  status?: number;
  /** Reject every request instead of responding. */
  networkDown?: boolean;
}

interface FakeServerFetch {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  calls: {
    method: string;
    url: string;
    body: string | null;
    user: string | null;
  }[];
}

// A fake rhizz-server standing in for fetch: serves one in-memory data dir
// with the per-project protocol (`GET /api/vfs`, `POST .../lock`,
// `PUT .../files`, `DELETE .../project`) and records every call it receives.
// Locks behave like the real side: free projects auto-acquire for the
// writer, held-by-other refuses with 409.
function makeFakeFetch(options: FakeServerFetchOptions = {}): FakeServerFetch {
  const calls: FakeServerFetch["calls"] = [];
  // Project files: path -> content (null means a directory).
  const projects = new Map<
    string,
    { name: string; files: Map<string, string | null> }
  >();
  const locks = new Map<string, string>();
  const versions = new Map<string, number>();

  // Seed from a whole-VFS blob: node ids are client bookkeeping, so paths
  // are rebuilt from the parent chain like the real server derives them.
  const seed = (blob: unknown) => {
    const data = blob as {
      projects?: { id: string; name: string }[];
      nodes?: {
        id: string;
        projectId: string;
        parentId: string | null;
        name: string;
        kind: string;
        content?: string;
      }[];
    };
    for (const p of data.projects ?? []) {
      // First wins, like `sanitizeVfsData`: a hand-edited blob can hold
      // two projects at one address, and the later one is dropped.
      if (!projects.has(p.id)) {
        projects.set(p.id, { name: p.name, files: new Map() });
        versions.set(p.id, 0);
      }
    }
    const byId = new Map((data.nodes ?? []).map((n) => [n.id, n]));
    for (const node of data.nodes ?? []) {
      const segments = [node.name];
      let parentId = node.parentId;
      const seen = new Set([node.id]);
      while (parentId !== null) {
        if (seen.has(parentId)) break;
        seen.add(parentId);
        const parent = byId.get(parentId);
        if (parent === undefined) break;
        segments.unshift(parent.name);
        parentId = parent.parentId;
      }
      const entry = projects.get(node.projectId);
      if (entry === undefined) continue;
      entry.files.set(
        segments.join("/"),
        node.kind === "file" ? (node.content ?? "") : null,
      );
    }
  };
  if (options.blob !== undefined) seed(options.blob);

  const versionOf = (id: string): string => `v${String(versions.get(id) ?? 0)}`;
  const userOf = (init?: RequestInit): string | null => {
    const headers = new Headers(init?.headers);
    return headers.get("x-rhizz-user");
  };

  const fetchImpl = (
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
    const body = typeof init?.body === "string" ? init.body : null;
    calls.push({ method, url, body, user: userOf(init) });
    if (options.networkDown) {
      return Promise.reject(new TypeError("network down"));
    }
    if (options.status !== undefined && options.status >= 400) {
      return Promise.resolve(
        new Response("failed", { status: options.status }),
      );
    }
    const match =
      /\/api\/projects\/([^/]+)(\/(state|lock|heartbeat|files))?$/.exec(url);
    if (match === null) {
      if (!url.endsWith("/api/vfs") || method !== "GET") {
        return Promise.resolve(new Response("not found", { status: 404 }));
      }
      const projectsJson = [...projects].map(([id, entry]) => ({
        id,
        name: entry.name,
        createdAt: "t0",
        updatedAt: "t0",
      }));
      const nodes: unknown[] = [];
      for (const [id, entry] of projects) {
        for (const [path, content] of entry.files) {
          const segments = path.split("/");
          const name = segments[segments.length - 1] ?? path;
          const parent =
            segments.length > 1
              ? `${id}/${segments.slice(0, -1).join("/")}`
              : null;
          nodes.push(
            content === null
              ? {
                  id: `${id}/${path}`,
                  projectId: id,
                  parentId: parent,
                  name,
                  kind: "directory",
                }
              : {
                  id: `${id}/${path}`,
                  projectId: id,
                  parentId: parent,
                  name,
                  kind: "file",
                  content,
                  revision: 0,
                  updatedAt: "t0",
                },
          );
        }
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({ version: 1, projects: projectsJson, nodes }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    }
    const [, projectId, , action] = match;
    if (projectId === undefined) {
      return Promise.resolve(new Response("not found", { status: 404 }));
    }
    const user = userOf(init);
    if (action === "lock" || action === "heartbeat") {
      if (user === null || user === "") {
        return Promise.resolve(new Response("missing user", { status: 400 }));
      }
      const holder = locks.get(projectId);
      if (holder !== undefined && holder !== user) {
        return Promise.resolve(
          new Response(JSON.stringify({ lockedBy: holder }), {
            status: 409,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      locks.set(projectId, user);
      return Promise.resolve(
        new Response(
          JSON.stringify({
            lockedBy: user,
            lockExpiresAt: "t1",
            version: versionOf(projectId),
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    }
    if (method === "PUT") {
      if (user === null || user === "") {
        return Promise.resolve(new Response("missing user", { status: 400 }));
      }
      const holder = locks.get(projectId);
      if (holder !== undefined && holder !== user) {
        return Promise.resolve(
          new Response(JSON.stringify({ lockedBy: holder }), {
            status: 409,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      locks.set(projectId, user);
      const parsed = JSON.parse(body ?? "{}") as {
        base_version?: string;
        files?: { path: string; content?: string }[];
      };
      if (
        parsed.base_version !== undefined &&
        parsed.base_version !== versionOf(projectId)
      ) {
        return Promise.resolve(
          new Response(JSON.stringify({ version: versionOf(projectId) }), {
            status: 409,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      let entry = projects.get(projectId);
      if (entry === undefined) {
        entry = { name: projectId, files: new Map() };
        projects.set(projectId, entry);
      }
      entry.files.clear();
      for (const file of parsed.files ?? []) {
        entry.files.set(file.path, file.content ?? null);
      }
      versions.set(projectId, (versions.get(projectId) ?? 0) + 1);
      return Promise.resolve(
        new Response(
          JSON.stringify({
            lockedBy: user,
            lockExpiresAt: "t1",
            version: versionOf(projectId),
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    }
    if (method === "DELETE") {
      if (user === null || user === "") {
        return Promise.resolve(new Response("missing user", { status: 400 }));
      }
      const holder = locks.get(projectId);
      if (holder !== undefined && holder !== user) {
        return Promise.resolve(
          new Response(JSON.stringify({ lockedBy: holder }), {
            status: 409,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      if (!projects.has(projectId)) {
        return Promise.resolve(
          new Response("unknown project", { status: 404 }),
        );
      }
      projects.delete(projectId);
      locks.delete(projectId);
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    return Promise.resolve(new Response("not found", { status: 404 }));
  };
  return { fetch: fetchImpl, calls };
}

describe("ServerProjectStore HTTP behavior", () => {
  it("fetches before a mutation and writes each project on save", async () => {
    const fake = makeFakeFetch();
    const store = new ServerProjectStore("http://rhizz-server", {
      fetch: fake.fetch,
      getUser: () => "alice",
    });
    await store.createProject("drone");
    expect(fake.calls.map((c) => c.method)).toEqual(["GET", "PUT"]);
    expect(fake.calls[0]?.url).toBe("http://rhizz-server/api/vfs");
    expect(fake.calls[1]?.url).toBe(
      "http://rhizz-server/api/projects/drone/files",
    );
    expect(fake.calls[1]?.user).toBe("alice");

    const putBody = JSON.parse(fake.calls[1]?.body ?? "{}") as {
      base_version?: string;
      files: unknown[];
    };
    // A fresh project holds no nodes yet; the version is lock-only.
    expect(putBody.base_version).toBeUndefined();
    expect(putBody.files).toEqual([]);
  });

  it("sends the edited project as paths on update", async () => {
    const fake = makeFakeFetch();
    const store = new ServerProjectStore("http://rhizz-server", {
      fetch: fake.fetch,
      getUser: () => "alice",
      now: () => "t0",
    });
    const project = await store.createProject("drone");
    await store.createFile(project.id, null, "system.hcl", "system {}");
    const put = [...fake.calls].reverse().find((c) => c.method === "PUT");
    expect(put?.url).toBe("http://rhizz-server/api/projects/drone/files");
    expect(JSON.parse(put?.body ?? "{}")).toEqual({
      files: [{ path: "system.hcl", content: "system {}" }],
    });
  });

  it("deletes the server directory of a removed project", async () => {
    const fake = makeFakeFetch();
    const store = new ServerProjectStore("http://rhizz-server", {
      fetch: fake.fetch,
      getUser: () => "alice",
      now: () => "t0",
    });
    const project = await store.createProject("drone");
    await store.deleteProject(project.id);
    const last = fake.calls[fake.calls.length - 1];
    expect(last?.method).toBe("DELETE");
    expect(last?.url).toBe("http://rhizz-server/api/projects/drone");
    // Gone from the next bootstrap too.
    expect(await store.listProjects()).toEqual([]);
  });

  it("refuses the whole mutation when the server holds the lock for someone else", async () => {
    const fake = makeFakeFetch({
      blob: {
        version: 1,
        projects: [
          {
            id: "drone",
            name: "drone",
            createdAt: "t0",
            updatedAt: "t0",
          },
        ],
        nodes: [],
      },
    });
    // Someone else takes the project directly against the fake server …
    const locked = await fake.fetch(
      "http://rhizz-server/api/projects/drone/lock",
      { method: "POST", headers: { "x-rhizz-user": "bob" } },
    );
    expect(locked.status).toBe(200);
    const store = new ServerProjectStore("http://rhizz-server", {
      fetch: fake.fetch,
      getUser: () => "alice",
      now: () => "t0",
    });
    // … so the store's own write is refused and the cache is dropped,
    // letting the next read start from the truth rather than the write
    // that failed.
    await expect(
      store.createFile("drone", null, "system.hcl", "system {}"),
    ).rejects.toThrow(/409/);
    expect(await store.listNodes("drone")).toEqual([]);
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

describe("node operations stay in their project even if ids collide", () => {
  // Defense in depth. `sanitizeVfsData` drops duplicate node ids on load, so a
  // store cannot normally hold one -- but `memoryBackend` takes a blob as-is,
  // which is how this reaches the ops. If the scoping ever regressed, a write
  // in one project would silently rewrite another's same-id node: exactly the
  // cross-project wipe of Task 119a, one layer down.
  const colliding = (): VfsData => {
    const file = (projectId: string) => ({
      id: "shared",
      projectId,
      parentId: null,
      name: "main.hcl",
      kind: "file" as const,
      content: projectId,
      revision: 0,
      updatedAt: "t0",
    });
    return {
      version: 1 as const,
      projects: [
        { id: "alpha", name: "alpha", createdAt: "t0", updatedAt: "t0" },
        { id: "beta", name: "beta", createdAt: "t0", updatedAt: "t0" },
      ],
      // Two nodes at one id, one per project: the shape the sanitizer refuses.
      nodes: [file("alpha"), file("beta")],
    };
  };

  const nodesOf = async (store: VfsProjectStore, projectId: string) =>
    (await store.listNodes(projectId)).map((n) => ({
      id: n.id,
      parentId: n.parentId,
      name: n.name,
      ...(n.kind === "file" ? { content: n.content } : {}),
    }));

  it("scopes the id-only operations to the project they were called for", async () => {
    // [the call, how many nodes the project it was called for is left with]
    const cases: [(s: VfsProjectStore) => Promise<void>, number][] = [
      [(s) => s.updateFileContent("beta", "shared", "beta's edit"), 1],
      [(s) => s.renameNode("beta", "shared", "renamed.hcl"), 1],
      [(s) => s.deleteNode("beta", "shared"), 0],
    ];
    const untouched = [
      { id: "shared", parentId: null, name: "main.hcl", content: "alpha" },
    ];
    for (const [call, kept] of cases) {
      const store = new VfsProjectStore(memoryBackend(colliding()));
      await call(store);
      expect(await nodesOf(store, "alpha")).toEqual(untouched);
      expect(await store.listNodes("beta")).toHaveLength(kept);
    }
  });

  it("scopes a re-parent to the project it was called for", async () => {
    const blob = colliding();
    const dir = (projectId: string) => ({
      id: `${projectId}-views`,
      projectId,
      parentId: null,
      name: "views",
      kind: "directory" as const,
    });
    blob.nodes = [...blob.nodes, dir("alpha"), dir("beta")];
    const store = new VfsProjectStore(memoryBackend(blob));

    // Move beta's file under beta's directory. Ids collide across projects, so
    // an unscoped rewrite would drag alpha's file along to alpha's directory.
    await store.moveNode("beta", "shared", "beta-views");

    const alpha = await nodesOf(store, "alpha");
    expect(alpha.find((n) => n.id === "shared")?.parentId).toBe(null);
    expect(alpha.some((n) => n.parentId === "beta-views")).toBe(false);
  });
});

describe("ambiguous ids in a stored blob", () => {
  // A node id has to be unique across the whole VFS: every operation in
  // ./operations resolves a node against all of `nodes` at once, so two nodes
  // at one id make a write ambiguous -- `updateFileContent` rewrites *every*
  // match, which is how a write in one project landed in another (TASKS/
  // FINISHED.md, Task 119a).
  //
  // Only the localStorage backend runs this case now: server blobs carry
  // path-derived ids (`apollo-11/system.hcl`), which cannot collide this
  // way, and per-project writes keep them separate structurally.
  const project = (id: string) => ({
    id,
    name: id,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  });
  const file = (id: string, projectId: string, content: string) => ({
    id,
    projectId,
    parentId: null,
    name: "system.hcl",
    kind: "file",
    content,
    revision: 0,
    updatedAt: "2024-01-01T00:00:00Z",
  });
  const blob = {
    version: 1,
    projects: [project("apollo-11"), project("drone")],
    nodes: [
      file("shared", "apollo-11", "apollo's content"),
      file("shared", "drone", "drone's content"),
    ],
  };

  it("keeps one node when a blob has two at the same id", async () => {
    const map = new Map<string, string>([["ambiguous", JSON.stringify(blob)]]);
    const store = new LocalStorageProjectStore(
      {
        getItem: (key) => map.get(key) ?? null,
        setItem: (key, value) => void map.set(key, value),
      },
      "ambiguous",
    );

    expect((await store.listNodes("apollo-11")).map((n) => n.id)).toEqual([
      "shared",
    ]);
    expect(await store.listNodes("drone")).toEqual([]);
    // The consequence that matters: writing the survivor no longer reaches
    // across into the project that shared its id.
    await store.updateFileContent("apollo-11", "shared", "edited");
    const survivors = await store.listNodes("apollo-11");
    expect(survivors).toHaveLength(1);
    expect(survivors[0]).toMatchObject({ content: "edited", revision: 1 });
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

    const names = (await store.listNodes(project.id))
      .map((n) => n.name)
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

describe("VfsProjectStore persisted-size reporting", () => {
  // Every mutation funnels through mutate(), so one reporter there covers all
  // backends and all operations — the byte size of the blob that was just
  // persisted, measured as the UTF-8 length of the canonical JSON the
  // backends themselves write. Reads report nothing: the blob did not change.
  function byteLengthOf(value: unknown): number {
    return new TextEncoder().encode(JSON.stringify(value)).length;
  }

  it("reports the persisted blob size after a mutation", async () => {
    const sizes: number[] = [];
    const store = new VfsProjectStore(
      memoryBackend(),
      () => "t0",
      () => "fixed-id",
      (bytes) => sizes.push(bytes),
    );
    await store.createProject("Drone System");
    expect(sizes).toHaveLength(1);
    expect(sizes[0]).toBeGreaterThan(0);
  });

  it("reports the exact canonical JSON size, growing with content", async () => {
    // A recording backend captures the very object handed to write(), so the
    // expected size is computed from the persisted blob itself rather than
    // reconstructed — key order and all.
    let written: VfsData | null = null;
    const recording: VfsBackend = {
      read: () => Promise.resolve(emptyVfsData()),
      write: (data) => {
        written = data;
        return Promise.resolve();
      },
    };
    const sizes: number[] = [];
    const store = new VfsProjectStore(
      recording,
      () => "t0",
      () => "fixed-id",
      (bytes) => sizes.push(bytes),
    );
    const project = await store.createProject("Drone System");
    await store.createFile(project.id, null, "system.hcl", 'system "x" {}\n');
    expect(sizes).toHaveLength(2);
    const [afterCreate, afterFile] = sizes;
    if (afterCreate === undefined || afterFile === undefined) {
      throw new Error("expected a size report per mutation");
    }
    expect(afterFile).toBeGreaterThan(afterCreate);
    expect(afterFile).toBe(byteLengthOf(written));
  });

  it("reports nothing for reads", async () => {
    const sizes: number[] = [];
    const store = new VfsProjectStore(
      memoryBackend(),
      () => "t0",
      () => "fixed-id",
      (bytes) => sizes.push(bytes),
    );
    await store.createProject("Drone System");
    sizes.length = 0;
    await store.listProjects();
    await store.listNodes("drone-system");
    expect(sizes).toEqual([]);
  });

  it("reports nothing when the backend rejects the write", async () => {
    // Nothing landed, so there is no new persisted size to describe — same
    // reason the lifecycle log stays silent in that case.
    const failing: VfsBackend = {
      read: () => Promise.resolve(emptyVfsData()),
      write: () => Promise.reject(new Error("disk full")),
    };
    const sizes: number[] = [];
    const store = new VfsProjectStore(
      failing,
      () => "t0",
      () => "fixed-id",
      (bytes) => sizes.push(bytes),
    );
    await expect(store.createProject("Drone System")).rejects.toThrow(
      "disk full",
    );
    expect(sizes).toEqual([]);
  });

  it("needs no reporter at all", async () => {
    // Every existing construction site omits it: mutations must work exactly
    // as before when nothing is wired up.
    const store = new VfsProjectStore(memoryBackend(), () => "t0");
    const project = await store.createProject("Drone System");
    expect(project.name).toBe("Drone System");
  });
});
