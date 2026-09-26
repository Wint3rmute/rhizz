import { describe, expect, it } from "vitest";
import { InvalidProjectNameError, projectSlug } from "./slug";

describe("projectSlug", () => {
  it("lower-cases and hyphenates a spaced name", () => {
    expect(projectSlug("Drone System")).toBe("drone-system");
  });

  it("is already-stable for a name that is a slug", () => {
    expect(projectSlug("drone-system")).toBe("drone-system");
  });

  it("collapses runs of punctuation and whitespace into one hyphen", () => {
    expect(projectSlug("Drone   System!! (v2)")).toBe("drone-system-v2");
  });

  it("trims leading and trailing separators", () => {
    expect(projectSlug("  *Drone System*  ")).toBe("drone-system");
  });

  it("keeps digits and inner separators", () => {
    expect(projectSlug("MQTT gateway 2")).toBe("mqtt-gateway-2");
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
    expect(projectSlug("Drone System")).not.toBe(
      projectSlug("Social Media"),
    );
  });
});
