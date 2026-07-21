import { describe, expect, it, vi } from "vitest";
import { sanitizeStoredRecord, StoredBoxSchema } from "./persistence";

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
