import { describe, expect, it, vi } from "vitest";
import { copyToClipboard } from "./clipboard";

describe("copyToClipboard", () => {
  it("resolves false without a DOM or clipboard", async () => {
    await expect(copyToClipboard("x")).resolves.toBe(false);
  });

  it("resolves true when clipboard.writeText succeeds", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    try {
      await expect(copyToClipboard("hello")).resolves.toBe(true);
      expect(writeText).toHaveBeenCalledWith("hello");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("resolves false when clipboard.writeText rejects", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    try {
      await expect(copyToClipboard("hello")).resolves.toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
