import init from "rhizz";
import * as nodeFs from "node:fs/promises";
import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { InMemoryProjectStore } from "../../../../vfs/vfsStore";
import { type Dirent, openProjectFs } from "../../../../vfs/fs";
import {
  emptyDiagramLayout,
  layoutFromSelection,
  layoutToHcl,
  mapLayoutToBoxes,
  parse_views,
  readDiagramLayoutFile,
  type StoredBox,
  VIEW_LAYOUT_DIR,
  viewPathFromName,
  viewPathTaken,
  viewsToLayout,
  writeDiagramLayoutFile,
} from "./persistence";

const MAIN_DIAGRAM_PATH = `${VIEW_LAYOUT_DIR}/main.hcl`;

async function projectFs() {
  const store = new InMemoryProjectStore();
  const project = await store.createProject("test");
  return openProjectFs(store, project.id);
}

beforeAll(async () => {
  const wasmPath = path.resolve(
    __dirname,
    "../../../../../../crates/rhizz-wasm/pkg/rhizz_wasm_bg.wasm",
  );
  const buffer = await nodeFs.readFile(wasmPath);
  await init({ module_or_path: buffer });
});

describe("HCL View conversion and persistence", () => {
  it("serializes DiagramLayout to clean HCL view block", () => {
    const layout = {
      checked: {
        "home/sensor": { x: 40, y: 60, width: 150, height: 90 },
        "home/controller": {
          x: 260,
          y: 40,
          width: 200,
          height: 170,
          textAlign: "top-left" as const,
        },
      },
    };

    const hcl = layoutToHcl(layout, "overview", "home");
    expect(hcl).toContain('view "overview"');
    expect(hcl).toContain('system      = "home"');
    expect(hcl).toContain('node "home/sensor"');
    expect(hcl).toContain("x          = 40");
    expect(hcl).toContain('text_align = "top-left"');
  });

  it("round-trips the view system through layoutToHcl and viewsToLayout", () => {
    const layout = {
      system: "quadcopter",
      checked: {
        "quadcopter/fc": { x: 10, y: 20 },
      },
    };
    const hcl = layoutToHcl(layout, "overview", "quadcopter");
    expect(hcl).toContain('system      = "quadcopter"');
    const back = viewsToLayout(parse_views(hcl));
    expect(back.system).toBe("quadcopter");
    // layout.system fallback when systemName arg is omitted
    const hcl2 = layoutToHcl(layout, "overview");
    expect(hcl2).toContain('system      = "quadcopter"');
  });

  it("defaults to empty system for legacy layouts without one", () => {
    const layout = viewsToLayout([
      { label: "overview", system: "", nodes: [] },
    ]);
    expect(layout.system).toBe("");
    expect(emptyDiagramLayout().system).toBe("");
    expect(emptyDiagramLayout("sys-a").system).toBe("sys-a");
  });

  it("converts parsed views to DiagramLayout", () => {
    const views = [
      {
        label: "overview",
        system: "home",
        nodes: [
          {
            component: "home/sensor",
            x: 40,
            y: 60,
            width: 150,
            height: 90,
          },
          {
            component: "home/controller",
            x: 260,
            y: 40,
            width: 200,
            height: 170,
            text_align: "top-left",
          },
        ],
      },
    ];

    const layout = viewsToLayout(views);
    expect(layout.checked["home/sensor"]).toEqual({
      x: 40,
      y: 60,
      width: 150,
      height: 90,
      textAlign: undefined,
    });
    expect(layout.checked["home/controller"]).toEqual({
      x: 260,
      y: 40,
      width: 200,
      height: 170,
      textAlign: "top-left",
    });
  });

  it("round-trips annotations through layoutToHcl and viewsToLayout", () => {
    const layout = {
      checked: {},
      annotations: [
        { text: "First line\nSecond line", x: 12.5, y: -3, scale: 1.5 },
        { text: "Standalone note", x: 0, y: 100 },
      ],
    };
    const hcl = layoutToHcl(layout, "overview", "home");
    expect(hcl).toContain("annotation {");
    // Non-default scale is persisted; the default (1) is not emitted.
    expect(hcl).toContain("scale = 1.5");
    expect(hcl).not.toMatch(/scale = 1\s/);

    // The real app path: parse -> viewsToLayout (which normalizes a serde-
    // defaulted scale: 1 back to absent).
    const back = parse_views(hcl);
    const layout2 = viewsToLayout(back);
    expect(layout2.annotations).toEqual(layout.annotations);
  });

  it("persists an annotation added after load, survives reload", async () => {
    // Mimics the user repro: fresh project -> load (empty layout) -> add an
    // annotation -> write -> reload -> annotation still there.
    const fs = await projectFs();

    // Fresh project starts with an empty (auto-seeded) diagram.
    await writeDiagramLayoutFile(
      fs,
      MAIN_DIAGRAM_PATH,
      emptyDiagramLayout(),
      "sys",
    );
    const layout = await readDiagramLayoutFile(fs, MAIN_DIAGRAM_PATH);
    expect(layout.annotations).toEqual([]);

    const anns = layout.annotations ?? [];
    // User adds an annotation (as addAnnotationHandler does) and edits text.
    anns.push({ text: "New note", x: 10, y: 10 });
    if (anns[0]) anns[0].text = "test";
    await writeDiagramLayoutFile(fs, MAIN_DIAGRAM_PATH, layout, "sys");

    // "Reload" (page switch) reads from the file again.
    const reloaded = await readDiagramLayoutFile(fs, MAIN_DIAGRAM_PATH);
    expect(reloaded.annotations).toEqual([
      { text: "test", x: 10, y: 10 },
    ]);
    // And the raw file on disk has the annotation block.
    const raw = await fs.readFile(MAIN_DIAGRAM_PATH);
    expect(raw).toContain("annotation {");
  });

  it("round-trips a written layout to HCL and back", async () => {
    const fs = await projectFs();
    const layout = {
      checked: {
        "sys/a": {
          x: 10,
          y: 20,
          width: 100,
          height: 50,
          textAlign: "top-left" as const,
        },
      },
      annotations: [
        { text: "Persisted note", x: 30, y: 40, scale: 1.5 },
      ],
    };
    await writeDiagramLayoutFile(fs, MAIN_DIAGRAM_PATH, layout, "sys");

    const content = await fs.readFile(MAIN_DIAGRAM_PATH);
    expect(content).toContain('view "main"');
    expect(content).toContain('node "sys/a"');
    expect(content).toContain("annotation {");
    expect(content).toContain("scale = 1.5");

    const read = await readDiagramLayoutFile(fs, MAIN_DIAGRAM_PATH);
    expect(read.checked["sys/a"]).toEqual(layout.checked["sys/a"]);
    expect(read.annotations).toEqual(layout.annotations);
  });

  it("persists and reads connection startSide and endSide configuration", async () => {
    const fs = await projectFs();
    const layout = {
      checked: {
        "sys/a": { x: 10, y: 20, width: 100, height: 50 },
        "sys/b": { x: 200, y: 20, width: 100, height: 50 },
      },
      connections: {
        "link-ab": { startSide: "bottom" as const, endSide: "left" as const },
      },
    };
    await writeDiagramLayoutFile(fs, MAIN_DIAGRAM_PATH, layout, "sys");

    const content = await fs.readFile(MAIN_DIAGRAM_PATH);
    expect(content).toContain('connection "link-ab"');
    expect(content).toContain('start_side = "bottom"');
    expect(content).toContain('end_side   = "left"');

    const read = await readDiagramLayoutFile(fs, MAIN_DIAGRAM_PATH);
    expect(read.connections?.["link-ab"]).toEqual({
      startSide: "bottom",
      endSide: "left",
    });
  });

  it("creates the containing directory on first write", async () => {
    const fs = await projectFs();
    await writeDiagramLayoutFile(fs, MAIN_DIAGRAM_PATH, emptyDiagramLayout());
    const entries = await fs.readdir(".", { recursive: true });
    expect(entries.some((e) => e.path === "views" && e.isDirectory())).toBe(
      true,
    );
  });

  it("returns an empty layout for unparseable garbage", async () => {
    const fs = await projectFs();
    await fs.mkdir(VIEW_LAYOUT_DIR, { recursive: true });
    await fs.writeFile(MAIN_DIAGRAM_PATH, "invalid { garbage !@#");
    expect(await readDiagramLayoutFile(fs, MAIN_DIAGRAM_PATH)).toEqual(
      emptyDiagramLayout(),
    );
  });
});

describe("view-level attributes survive a Modeling round trip", () => {
  // Regression guard: Modeling reads a view into a canvas-shaped layout and
  // writes it straight back, so anything the canvas does not model was being
  // deleted merely by *opening* the view. `SPEC.md` §2.10 promises the filter
  // is "parsed and round-tripped"; `full_name` and `tags` are ordinary view
  // attributes and were lost the same way.
  const FILTER_VIEW = `view "engineering-teams" {
  full_name = "Engineering department internal structure"
  system      = "acme-software"
  tags        = ["internal", "teams"]

  filter {
    max_level     = 3
    components    = ["engineering"]
  }

  node "acme-software/engineering" {
    x          = 240
    y          = 360
    width      = 300
    height     = 320
    text_align = "top-center"
  }
}
`;

  it("carries full_name, tags and the filter out of a parsed view", () => {
    const layout = viewsToLayout(parse_views(FILTER_VIEW));
    expect(layout.fullName).toBe("Engineering department internal structure");
    expect(layout.tags).toEqual(["internal", "teams"]);
    // The wasm parser fills serde's defaults for every filter field, so
    // compare the two that were actually written.
    expect(layout.filter?.max_level).toBe(3);
    expect(layout.filter?.components).toEqual(["engineering"]);
    // …and the positional half still reads.
    expect(layout.checked["acme-software/engineering"]).toEqual({
      x: 240,
      y: 360,
      width: 300,
      height: 320,
      textAlign: "top-center",
    });
  });

  it("writes them back out unchanged", () => {
    const hcl = layoutToHcl(
      viewsToLayout(parse_views(FILTER_VIEW)),
      "engineering-teams",
      "acme-software",
    );
    expect(hcl).toContain(
      'full_name = "Engineering department internal structure"',
    );
    expect(hcl).toContain('tags        = ["internal", "teams"]');
    expect(hcl).toContain("filter {");
    expect(hcl).toContain("max_level     = 3");
    expect(hcl).toContain('components    = ["engineering"]');
  });

  it("round-trips the whole file without losing anything", () => {
    const first = layoutToHcl(
      viewsToLayout(parse_views(FILTER_VIEW)),
      "engineering-teams",
      "acme-software",
    );
    const second = layoutToHcl(
      viewsToLayout(parse_views(first)),
      "engineering-teams",
      "acme-software",
    );
    expect(second).toBe(first);
  });

  it("still omits them for a view that never had them", () => {
    const hcl = layoutToHcl(
      emptyDiagramLayout("acme-software"),
      "fresh",
      "acme-software",
    );
    expect(hcl).not.toContain("full_name");
    expect(hcl).not.toContain("filter {");
  });

  it("survives a real read-then-write through the project filesystem", async () => {
    // The whole reported failure in one test: what Modeling does on open.
    const fs = await projectFs();
    await fs.mkdir(VIEW_LAYOUT_DIR, { recursive: true });
    await fs.writeFile(MAIN_DIAGRAM_PATH, FILTER_VIEW);

    const layout = await readDiagramLayoutFile(fs, MAIN_DIAGRAM_PATH);
    await writeDiagramLayoutFile(
      fs,
      MAIN_DIAGRAM_PATH,
      layout,
      "acme-software",
    );

    // Re-serializing is canonical (fixed field order), so compare the parsed
    // form rather than the bytes: what must not change is the content.
    const written = await fs.readFile(MAIN_DIAGRAM_PATH);
    const reread = viewsToLayout(parse_views(written));
    expect(reread.fullName).toBe("Engineering department internal structure");
    expect(reread.tags).toEqual(["internal", "teams"]);
    expect(reread.filter?.max_level).toBe(3);
    expect(reread.filter?.components).toEqual(["engineering"]);
    expect(Object.keys(reread.checked)).toEqual(["acme-software/engineering"]);
  });
});

describe("mapLayoutToBoxes", () => {
  const keyToIndex = new Map<string, number>([
    ["drone/fc", 0],
    ["drone/fc/mcu", 1],
  ]);

  it("maps layout checked records to placed node boxes", () => {
    const checked = {
      "drone/fc": {
        x: 50,
        y: 60,
        width: 200,
        height: 150,
        textAlign: "top-left" as const,
      },
      "drone/fc/mcu": { x: 80, y: 100 },
      "drone/unknown": { x: 10, y: 10 },
    };

    const boxes = mapLayoutToBoxes(checked, keyToIndex);
    expect(boxes[0]).toEqual({
      x: 50,
      y: 60,
      width: 200,
      height: 150,
      textAlign: "top-left",
    });
    expect(boxes[1]).toEqual({
      x: 80,
      y: 100,
      width: 100,
      height: 100,
      textAlign: "center",
    });
    expect(boxes[2]).toBeUndefined();
  });
});

describe("view paths and the selection-derived layout", () => {
  const dirent = (path: string, kind: "file" | "dir"): Dirent => ({
    name: path.split("/").pop() ?? path,
    path,
    isFile: () => kind === "file",
    isDirectory: () => kind === "dir",
  });

  const CHECKED: Record<string, StoredBox> = {
    "main/mcu": { x: 10, y: 20, width: 120, height: 80, textAlign: "top-left" },
    "main/imu": { x: 200, y: 20 },
    "main/radio": { x: 400, y: 20 },
  };

  it.each([
    ["overview", "overview.hcl"],
    ["overview.hcl", "overview.hcl"],
    ["  overview  ", "overview.hcl"],
  ])("reads %j as the path %j", (name, expected) => {
    expect(viewPathFromName(name)).toBe(expected);
  });

  it.each([["   "], ["sub/overview"]])(
    "rejects %j — a name is one path segment, and never blank",
    (name) => {
      expect(viewPathFromName(name)).toBeNull();
    },
  );

  it("is taken when a view file already sits at that path", () => {
    expect(
      viewPathTaken(
        [dirent("main.hcl", "file"), dirent("over.hcl", "file")],
        "over.hcl",
      ),
    ).toBe(true);
  });

  it("is free for a different view", () => {
    expect(viewPathTaken([dirent("main.hcl", "file")], "overview.hcl")).toBe(
      false,
    );
  });

  it("is free for a directory of the same name", () => {
    // `views/overview/` is a folder, so `views/overview.hcl` is still free.
    expect(viewPathTaken([dirent("overview", "dir")], "overview.hcl")).toBe(
      false,
    );
  });

  it("places only the selected components, at the boxes they have here", () => {
    // One assertion on the whole record, because "just the selection" and
    // "carrying size and alignment over" are the same claim: a node that came
    // across with only its position would differ here too.
    const layout = layoutFromSelection("main", CHECKED, [
      "main/mcu",
      "main/imu",
    ]);
    expect(layout.checked).toEqual({
      "main/mcu": {
        x: 10,
        y: 20,
        width: 120,
        height: 80,
        textAlign: "top-left",
      },
      "main/imu": { x: 200, y: 20 },
    });
  });

  it("does not alias the boxes it copies — later edits stay in this view", () => {
    const layout = layoutFromSelection("main", CHECKED, ["main/mcu"]);
    const copied = layout.checked["main/mcu"];
    if (!copied) throw new Error("the selected component was not copied");
    copied.x = 999;
    expect(CHECKED["main/mcu"]?.x).toBe(10);
  });

  it("skips a selected key that has no box on the canvas", () => {
    // A key can outlive its component (renamed away, reparented); the new
    // view must not gain a node the model can't resolve.
    const layout = layoutFromSelection("main", CHECKED, ["main/mcu", "gone"]);
    expect(Object.keys(layout.checked)).toEqual(["main/mcu"]);
  });

  it("binds to the given system", () => {
    expect(layoutFromSelection("drone", CHECKED, ["main/mcu"]).system).toBe(
      "drone",
    );
  });

  it("carries the selected annotations across, where they already are", () => {
    const layout = layoutFromSelection(
      "main",
      CHECKED,
      ["main/mcu"],
      [{ text: "check this", x: 30, y: 40, scale: 1.5 }],
    );
    expect(layout.annotations).toEqual([
      { text: "check this", x: 30, y: 40, scale: 1.5 },
    ]);
  });

  it("does not alias the annotations it copies either", () => {
    const note = { text: "check this", x: 30, y: 40 };
    const layout = layoutFromSelection("main", CHECKED, [], [note]);
    const copied = layout.annotations?.[0];
    if (!copied) throw new Error("the annotation was not copied");
    copied.text = "edited";
    expect(note.text).toBe("check this");
  });

  it("leaves no annotations behind when the selection has none", () => {
    const layout = layoutFromSelection("main", CHECKED, ["main/mcu"], []);
    expect(layout.annotations).toEqual([]);
  });

  it("brings none of the old view's connection overrides", () => {
    const layout = layoutFromSelection("main", CHECKED, ["main/mcu"], []);
    expect(layout.connections).toEqual({});
  });
});
