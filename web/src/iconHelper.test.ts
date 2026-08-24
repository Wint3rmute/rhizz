import { describe, expect, it } from "vitest";
import { normalizeIconName, resolveIcon } from "./iconHelper";

describe("iconHelper", () => {
  it("normalizes icon names with various prefixes and formats", () => {
    expect(normalizeIconName("microchip")).toBe("faMicrochip");
    expect(normalizeIconName("fa-microchip")).toBe("faMicrochip");
    expect(normalizeIconName("faMicrochip")).toBe("faMicrochip");
    expect(normalizeIconName("battery-full")).toBe("faBatteryFull");
    expect(normalizeIconName("fa-battery-full")).toBe("faBatteryFull");
    expect(normalizeIconName("server")).toBe("faServer");
  });

  it("resolves valid FontAwesome icons to SVG geometry", () => {
    const icon = resolveIcon("microchip");
    expect(icon).toBeDefined();
    expect(icon?.width).toBeGreaterThan(0);
    expect(icon?.height).toBeGreaterThan(0);
    expect(icon?.svgPath).toBeTypeOf("string");
    expect(icon?.svgPath.length).toBeGreaterThan(0);
  });

  it("resolves icons with fa- prefix", () => {
    const icon = resolveIcon("fa-server");
    expect(icon).toBeDefined();
    expect(icon?.svgPath).toBeTypeOf("string");
  });

  it("returns null for nonexistent or empty icon names", () => {
    expect(resolveIcon("")).toBeNull();
    expect(resolveIcon(null)).toBeNull();
    expect(resolveIcon(undefined)).toBeNull();
    expect(resolveIcon("nonexistent-icon-xyz-123")).toBeNull();
  });
});
