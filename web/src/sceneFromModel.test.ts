import init from "rhizz";
import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { sceneFromModel, type SceneRouting } from "./modelView";
import { compile_system } from "./rhizz_wasm_wrapper";
import type {
  SceneAnnotationInput,
  SceneBoxInput,
} from "./routes/projects/[id]/modeling/diagramScene";

beforeAll(async () => {
  const wasmPath = nodePath.resolve(
    __dirname,
    "../../crates/rhizz-wasm/pkg/rhizz_wasm_bg.wasm",
  );
  const buffer = await nodeFs.readFile(wasmPath);
  await init({ module_or_path: buffer });
});

const HCL = `protocol "spi" {
  message "frame" {
    field "cs" {
      type = "uint8"
    }
  }
}
component "imu" {
  leaf  = true
  icon  = "microchip"
  color = "#ff0000"
  border = "dashed"
  font   = "bold"
  port "bus-in" {
    protocol = "spi"
    role     = "consumer"
  }
}
system "demo" {
  instance "flight" {
    source = "imu"
  }
}
`;

function modelOf(hcl: string) {
  return compile_system([{ filename: "system.hcl", content: hcl }]).model();
}

function sceneOf(
  boxes: Record<string, SceneBoxInput>,
  hcl = HCL,
  annotations: SceneAnnotationInput[] = [],
  routing: Record<string, SceneRouting> = {},
  include?: (key: string) => boolean,
) {
  return sceneFromModel(modelOf(hcl), boxes, annotations, routing, include);
}

const TWO = `component "a" {
  leaf = true
}
component "b" {
  leaf = true
}
system "demo" {
  instance "a" {
    source = "a"
  }
  instance "b" {
    source = "b"
  }
  connection "link" {
    from = "a"
    to   = "b"
  }
}
`;

describe("sceneFromModel", () => {
  it("returns an empty scene for an undefined model", () => {
    const s = sceneFromModel(undefined, {});
    expect(s.nodes).toEqual([]);
    expect(s.edges).toEqual([]);
    expect(s.bounds).toBeNull();
  });

  it("keys nodes by their qualified component key, not arena index", () => {
    expect(
      sceneOf({ "demo/flight": { x: 10, y: 20, width: 50, height: 60 } })
        .nodes.map((n) => n.key),
    ).toEqual(["demo/flight"]);
  });

  it("ignores components with no box — they are not on the canvas", () => {
    // `imu` is a top-level definition; only a placed instance draws.
    const keys = sceneOf({ "demo/flight": { x: 0, y: 0 } })
      .nodes.map((n) => n.key);
    expect(keys).toEqual(["demo/flight"]);
  });

  it("carries visual attributes through the shared ComponentData projection", () => {
    // `flight` is an instance of `imu`, so it inherits imu's appearance.
    const node = sceneOf({ "demo/flight": { x: 0, y: 0 } }).nodes[0];
    expect(node?.icon).toBe("microchip");
    expect(node?.color).toBe("#ff0000");
    expect(node?.border).toBe("dashed");
    expect(node?.font).toBe("bold");
  });

  it("normalises an absent icon to undefined, not an empty string", () => {
    // `TWO`'s components declare no icon, so the key must be absent rather
    // than present-and-empty — `resolveIcon` treats those differently.
    const node = sceneOf({ "demo/a": { x: 0, y: 0 } }, TWO).nodes[0];
    expect(node?.icon).toBeUndefined();
  });

  it("links parent keys so depth and render order are correct", () => {
    const nested = `component "leaf" {
  leaf = true
}
component "mid" {
  instance "inner" {
    source = "leaf"
  }
}
system "demo" {
  instance "outer" {
    source = "mid"
  }
}
`;
    const s = sceneOf(
      { "demo/outer": { x: 0, y: 0 }, "demo/outer/inner": { x: 10, y: 10 } },
      nested,
    );
    expect(s.nodes.map((n) => n.key)).toEqual([
      "demo/outer",
      "demo/outer/inner",
    ]);
    expect(s.byKey.get("demo/outer/inner")?.parentKey).toBe("demo/outer");
    expect(s.byKey.get("demo/outer/inner")?.depth).toBe(1);
  });

  it("converts model connections into key-addressed scene edges", () => {
    const s = sceneOf(
      { "demo/a": { x: 0, y: 0 }, "demo/b": { x: 300, y: 0 } },
      TWO,
    );
    expect(s.edges).toHaveLength(1);
    expect(s.edges[0]?.fromKey).toBe("demo/a");
    expect(s.edges[0]?.toKey).toBe("demo/b");
    expect(s.edges[0]?.d).toMatch(/^M /);
  });

  it("applies persisted per-connection routing overrides", () => {
    const boxes = { "demo/a": { x: 0, y: 0 }, "demo/b": { x: 300, y: 0 } };
    const auto = sceneFromModel(modelOf(TWO), boxes);
    const pinned = sceneFromModel(modelOf(TWO), boxes, [], {
      link: { startSide: "bottom" },
    });
    // Pinning the start side must change where the edge leaves `a`.
    expect(pinned.edges[0]?.a).not.toEqual(auto.edges[0]?.a);
    expect(pinned.edges[0]?.orientation).toBe("vertical");
  });

  it("drops edges whose endpoints are not both placed on the canvas", () => {
    expect(sceneOf({ "demo/a": { x: 0, y: 0 } }, TWO).edges).toEqual([]);
  });

  it("scopes nodes and edges together via include", () => {
    const s = sceneOf(
      { "demo/a": { x: 0, y: 0 }, "demo/b": { x: 300, y: 0 } },
      TWO,
      [],
      {},
      (key) => key === "demo/a",
    );
    expect(s.nodes.map((n) => n.key)).toEqual(["demo/a"]);
    expect(s.edges).toEqual([]);
  });

  it("projects ports with their role, so the scene can place them", () => {
    expect(
      sceneOf({ "demo/flight": { x: 0, y: 0, width: 50, height: 60 } })
        .nodes[0]?.ports,
    ).toEqual([{
      label: "bus-in",
      role: "consumer",
      protocol: "spi",
      x: 0,
      y: 30,
    }]);
  });

  it("gives a component with no ports an empty port list", () => {
    const node = sceneOf(
      { "demo/a": { x: 0, y: 0, width: 10, height: 20 } },
      `component "a" {
  leaf = true
}
system "demo" {
  instance "a" {
    source = "a"
  }
}
`,
    ).nodes[0];
    expect(node?.ports).toEqual([]);
  });
});
