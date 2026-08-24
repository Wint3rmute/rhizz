import { describe, expect, it } from "vitest";
import { searchIcons } from "../iconHelper";

describe("IconAutocompleteInput logic", () => {
  it("searches and returns suggestions for typed query", () => {
    const results = searchIcons("server", 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].name).toBe("server");
  });

  it("returns multiple matches when search is broad", () => {
    const results = searchIcons("bat", 5);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some((r) => r.name.includes("battery"))).toBe(true);
  });
});
