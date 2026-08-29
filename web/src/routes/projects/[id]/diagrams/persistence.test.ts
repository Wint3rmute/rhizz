import init from "rhizz";
import * as nodeFs from "node:fs/promises";
import * as path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { InMemoryProjectStore } from "../../../../vfs/inMemoryStore";
import { openProjectFs } from "../../../../vfs/fs";
import {
  buildKeyToIndexMap,
  componentKey,
  DIAGRAM_LAYOUT_DIR,
  emptyDiagramLayout,
  layoutToHcl,
  mapLayoutToBoxes,
  readDiagramLayoutFile,
  sanitizeStoredRecord,
  StoredBoxSchema,
  viewsToLayout,
  writeDiagramLayoutFile,
} from "./persistence";

const MAIN_DIAGRAM_PATH = `${DIAGRAM_LAYOUT_DIR}/main.hcl`;

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

describe("StoredBoxSchema", () => {
  it("accepts a fully-populated valid entry", () => {
    const result = StoredBoxSchema.safeParse({
      x: 10,
      y: 20,
      width: 100,
      height: 50,
      textAlign: "top-left",
    });
    expect(result.success).toBe(true);
  });

  it("accepts an entry with only the required x/y fields", () => {
    const result = StoredBoxSchema.safeParse({ x: 10, y: 20 });
    expect(result.success).toBe(true);
  });

  it("rejects a non-numeric x", () => {
    const result = StoredBoxSchema.safeParse({ x: "10", y: 20 });
    expect(result.success).toBe(false);
  });

  it("rejects a missing y", () => {
    const result = StoredBoxSchema.safeParse({ x: 10 });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid textAlign value", () => {
    const result = StoredBoxSchema.safeParse({
      x: 10,
      y: 20,
      textAlign: "bottom-right",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a completely malformed entry", () => {
    expect(StoredBoxSchema.safeParse(null).success).toBe(false);
    expect(StoredBoxSchema.safeParse("garbage").success).toBe(false);
    expect(StoredBoxSchema.safeParse([1, 2, 3]).success).toBe(false);
  });
});

describe("sanitizeStoredRecord", () => {
  it("passes valid entries through unchanged", () => {
    const record = {
      a: { x: 1, y: 2 },
      b: { x: 3, y: 4, width: 100, height: 50, textAlign: "center" },
    };
    expect(sanitizeStoredRecord(record)).toEqual(record);
  });

  it("drops a malformed entry without affecting valid siblings", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const record = {
      good: { x: 1, y: 2 },
      bad: { x: "not a number", y: 2 },
    };
    expect(sanitizeStoredRecord(record)).toEqual({ good: { x: 1, y: 2 } });
    warnSpy.mockRestore();
  });

  it("drops multiple malformed entries independently", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const record = {
      good1: { x: 1, y: 2 },
      bad1: { x: null, y: 2 },
      good2: { x: 5, y: 6 },
      bad2: "garbage",
    };
    expect(sanitizeStoredRecord(record)).toEqual({
      good1: { x: 1, y: 2 },
      good2: { x: 5, y: 6 },
    });
    warnSpy.mockRestore();
  });

  it("returns an empty record when every entry is malformed", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(sanitizeStoredRecord({ bad: {} })).toEqual({});
    warnSpy.mockRestore();
  });

  it("returns an empty record for an empty input", () => {
    expect(sanitizeStoredRecord({})).toEqual({});
  });
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
      savedLayout: {},
    };

    const hcl = layoutToHcl(layout, "overview", "home");
    expect(hcl).toContain('view "overview"');
    expect(hcl).toContain('system      = "home"');
    expect(hcl).toContain('node "home/sensor"');
    expect(hcl).toContain("x          = 40");
    expect(hcl).toContain('text_align = "top-left"');
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

  it("returns an empty layout when the file has never been saved", async () => {
    const fs = await projectFs();
    expect(await readDiagramLayoutFile(fs, MAIN_DIAGRAM_PATH)).toEqual(
      emptyDiagramLayout(),
    );
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
      savedLayout: {
        "sys/a": {
          x: 10,
          y: 20,
          width: 100,
          height: 50,
          textAlign: "top-left" as const,
        },
      },
    };
    await writeDiagramLayoutFile(fs, MAIN_DIAGRAM_PATH, layout, "sys");

    const content = await fs.readFile(MAIN_DIAGRAM_PATH);
    expect(content).toContain('view "main"');
    expect(content).toContain('node "sys/a"');

    const read = await readDiagramLayoutFile(fs, MAIN_DIAGRAM_PATH);
    expect(read.checked["sys/a"]).toEqual(layout.checked["sys/a"]);
  });

  it("persists and reads connection startSide and endSide configuration", async () => {
    const fs = await projectFs();
    const layout = {
      checked: {
        "sys/a": { x: 10, y: 20, width: 100, height: 50 },
        "sys/b": { x: 200, y: 20, width: 100, height: 50 },
      },
      savedLayout: {
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
    expect(entries.some((e) => e.path === "diagrams" && e.isDirectory())).toBe(
      true,
    );
  });

  it("returns an empty layout for unparseable garbage", async () => {
    const fs = await projectFs();
    await fs.mkdir(DIAGRAM_LAYOUT_DIR, { recursive: true });
    await fs.writeFile(MAIN_DIAGRAM_PATH, "invalid { garbage !@#");
    expect(await readDiagramLayoutFile(fs, MAIN_DIAGRAM_PATH)).toEqual(
      emptyDiagramLayout(),
    );
  });
});

describe("componentKey and model mapping helpers", () => {
  const systems = [{ label: "drone" }];
  const components = [
    { label: "fc", parent_system_index: 0 },
    { label: "mcu", parent_component_index: 0 },
    { label: "imu", parent_component_index: 0 },
  ];

  it("builds hierarchical path keys for components", () => {
    expect(componentKey(0, components, systems)).toBe("drone/fc");
    expect(componentKey(1, components, systems)).toBe("drone/fc/mcu");
    expect(componentKey(2, components, systems)).toBe("drone/fc/imu");
  });

  it("falls back to #<index> when component index is out of bounds", () => {
    expect(componentKey(99, components, systems)).toBe("#99");
  });

  it("builds reverse lookup map from keys to indices", () => {
    const map = buildKeyToIndexMap(components, systems);
    expect(map.get("drone/fc")).toBe(0);
    expect(map.get("drone/fc/mcu")).toBe(1);
    expect(map.get("drone/fc/imu")).toBe(2);
  });

  it("maps layout checked records to placed node boxes", () => {
    const keyToIndex = buildKeyToIndexMap(components, systems);
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
