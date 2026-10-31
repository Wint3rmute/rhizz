import { describe, expect, it } from "vitest";
import { InvalidProjectNameError, projectSlug } from "./slug";

describe("projectSlug", () => {
  it.each([
    ["Drone System", "drone-system"],
    ["drone-system", "drone-system"],
    ["Drone   System!! (v2)", "drone-system-v2"],
    ["  *Drone System*  ", "drone-system"],
    ["MQTT gateway 2", "mqtt-gateway-2"],
  ])("normalizes %j to %j", (input, expected) => {
    expect(projectSlug(input)).toBe(expected);
  });

  it("folds case so differently-cased names collide on one address", () => {
    // The collision is the point: these two names must land on the same
    // slug, which is what makes the second create a duplicate.
    expect(projectSlug("Drone System")).toBe(projectSlug("DRONE system"));
  });

  it("rejects a name with no characters usable in an address", () => {
    expect(() => projectSlug("   ")).toThrow(InvalidProjectNameError);
    expect(() => projectSlug("!!!")).toThrow(InvalidProjectNameError);
    expect(() => projectSlug("")).toThrow(InvalidProjectNameError);
  });

  it("reports the offending name in a message the UI can show as-is", () => {
    try {
      projectSlug("???");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidProjectNameError);
      expect((error as Error).message).toContain("???");
    }
  });

  it("gives two different names different slugs (no gratuitous collisions)", () => {
    expect(projectSlug("Drone System")).not.toBe(projectSlug("Social Media"));
  });
});
