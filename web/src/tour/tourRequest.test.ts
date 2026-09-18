import { describe, expect, it } from "vitest";
import { getTourRequest, requestTourStart } from "./tourRequest.svelte";

describe("tourRequest", () => {
  it("bumps the generation and carries the target project", () => {
    const before = getTourRequest().generation;
    requestTourStart("project-a");
    const after = getTourRequest();
    expect(after.generation).toBe(before + 1);
    expect(after.projectId).toBe("project-a");
  });

  it("defaults to a project-less request", () => {
    requestTourStart();
    expect(getTourRequest().projectId).toBeNull();
  });
});
