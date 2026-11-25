import { describe, expect, it } from "vitest";
import { getSettingsRequest, requestSettings } from "./settingsRequest.svelte";

describe("settingsRequest", () => {
  it("bumps the generation", () => {
    const before = getSettingsRequest().generation;
    requestSettings();
    expect(getSettingsRequest().generation).toBe(before + 1);
  });

  it("bumps again on every request", () => {
    const before = getSettingsRequest().generation;
    requestSettings();
    requestSettings();
    expect(getSettingsRequest().generation).toBe(before + 2);
  });
});
