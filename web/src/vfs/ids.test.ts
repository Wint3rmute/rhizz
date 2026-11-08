// `generateId()` must work outside secure contexts (plain http), where
// `crypto.randomUUID()` does not exist and project creation used to crash
// with "crypto.randomUUID is not a function".
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateId } from "./ids";

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("generateId", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("generates UUIDv4-shaped ids", () => {
    expect(generateId()).toMatch(UUID_V4);
  });

  it("generates unique ids", () => {
    const seen = new Set(Array.from({ length: 1000 }, () => generateId()));
    expect(seen.size).toBe(1000);
  });

  it("falls back to getRandomValues when randomUUID is unavailable (plain http)", () => {
    const realCrypto = globalThis.crypto;
    vi.stubGlobal("crypto", {
      getRandomValues: realCrypto.getRandomValues.bind(realCrypto),
    });
    expect(generateId()).toMatch(UUID_V4);
  });

  it("falls back to Math.random when WebCrypto is entirely absent", () => {
    vi.stubGlobal("crypto", undefined);
    expect(generateId()).toMatch(UUID_V4);
  });
});
