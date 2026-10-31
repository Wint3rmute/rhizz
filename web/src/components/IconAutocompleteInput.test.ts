import { describe, expect, it } from "vitest";
import { searchIcons } from "../iconHelper";

describe("IconAutocompleteInput logic", () => {
  it.each([
    ["server", "server", true],
    ["bat", "battery", false],
  ])("searches %j and suggests %j icons", (query, expected, exactFirst) => {
    const results = searchIcons(query, 5);
    expect(results.length).toBeGreaterThanOrEqual(1);
    if (exactFirst) {
      expect(results[0]?.name).toBe(expected);
    } else {
      expect(results.some((r) => r.name.includes(expected))).toBe(true);
    }
  });
});
