import { describe, expect, it } from "vitest";
import { searchIcons } from "../iconHelper";

describe("IconAutocompleteInput logic", () => {
  it.each([
    ["server", "server"],
    ["bat", "battery"],
  ])("searches %j and suggests %j icons", (query, expected) => {
    const results = searchIcons(query, 5);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(
      results.some(
        (r) => r.name === expected || r.name.includes(expected),
      ),
    ).toBe(true);
  });
});
