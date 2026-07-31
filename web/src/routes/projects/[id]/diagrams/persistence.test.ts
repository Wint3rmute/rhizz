import { describe, expect, it, vi } from "vitest";
import { InMemoryProjectStore } from "../../../../vfs/inMemoryStore";
import { openProjectFs } from "../../../../vfs/fs";
import {
  CHECKED_NODES_PATH,
  readDiagramLayoutFile,
  sanitizeStoredRecord,
  StoredBoxSchema,
  writeDiagramLayoutFile,
} from "./persistence";

async function projectFs() {
  const store = new InMemoryProjectStore();
  const project = await store.createProject("test");
  return openProjectFs(store, project.id);
}

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
    // Matches data persisted before width/height/textAlign existed.
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

  it("warns once, naming every dropped key", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    sanitizeStoredRecord({
      good: { x: 1, y: 2 },
      bad1: {},
      bad2: {},
    });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = warnSpy.mock.calls[0][0] as string;
    expect(message).toContain("bad1");
    expect(message).toContain("bad2");
    warnSpy.mockRestore();
  });

  it("does not warn when every entry is valid", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    sanitizeStoredRecord({ good: { x: 1, y: 2 } });
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe("readDiagramLayoutFile / writeDiagramLayoutFile", () => {
  it("returns an empty record when the file has never been saved", async () => {
    const fs = await projectFs();
    expect(await readDiagramLayoutFile(fs, CHECKED_NODES_PATH)).toEqual({});
  });

  it("round-trips a written record", async () => {
    const fs = await projectFs();
    const data = { "sys/a": { x: 1, y: 2, width: 100, height: 50 } };
    await writeDiagramLayoutFile(fs, CHECKED_NODES_PATH, data);
    expect(await readDiagramLayoutFile(fs, CHECKED_NODES_PATH)).toEqual(data);
  });

  it("creates the containing directory on first write", async () => {
    const fs = await projectFs();
    await writeDiagramLayoutFile(fs, CHECKED_NODES_PATH, {});
    const entries = await fs.readdir(".", { recursive: true });
    expect(entries.some((e) => e.path === ".rhizz" && e.isDirectory())).toBe(
      true,
    );
  });

  it("drops malformed entries when reading a hand-edited file", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fs = await projectFs();
    await fs.mkdir(".rhizz/diagrams", { recursive: true });
    await fs.writeFile(
      CHECKED_NODES_PATH,
      JSON.stringify({ good: { x: 1, y: 2 }, bad: { x: "nope" } }),
    );
    expect(await readDiagramLayoutFile(fs, CHECKED_NODES_PATH)).toEqual({
      good: { x: 1, y: 2 },
    });
    warnSpy.mockRestore();
  });

  it("returns an empty record for malformed JSON", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fs = await projectFs();
    await fs.mkdir(".rhizz/diagrams", { recursive: true });
    await fs.writeFile(CHECKED_NODES_PATH, "not json{");
    expect(await readDiagramLayoutFile(fs, CHECKED_NODES_PATH)).toEqual({});
    warnSpy.mockRestore();
  });

  it("returns an empty record when the file's top level isn't an object", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fs = await projectFs();
    await fs.mkdir(".rhizz/diagrams", { recursive: true });
    await fs.writeFile(CHECKED_NODES_PATH, JSON.stringify([1, 2, 3]));
    expect(await readDiagramLayoutFile(fs, CHECKED_NODES_PATH)).toEqual({});
    warnSpy.mockRestore();
  });
});
