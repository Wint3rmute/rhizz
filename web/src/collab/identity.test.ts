// The Vitest setup has no DOM environment, so `localStorage` is absent and
// `safeStorage` degrades to missing/null — exactly the storage-blocked case
// the identity helper must survive.
import { describe, expect, it } from "vitest";
import { USERNAME_KEY, getOrCreateUsername, getUsername } from "./identity";
import { safeGetItem } from "../safeStorage";

describe("collab identity", () => {
  it("reports no username when storage is unavailable", () => {
    expect(safeGetItem(USERNAME_KEY)).toBeNull();
    expect(getUsername()).toBeNull();
  });

  it("mints a guest username that never throws", () => {
    const first = getOrCreateUsername();
    const second = getOrCreateUsername();
    expect(first).toMatch(/^guest-[0-9a-f]{8}$/);
    // Without persistence every call mints a fresh one instead of crashing.
    expect(second).toMatch(/^guest-[0-9a-f]{8}$/);
  });
});
