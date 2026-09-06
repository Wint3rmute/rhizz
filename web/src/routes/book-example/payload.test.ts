import { describe, expect, it } from "vitest";
import {
  BookPayloadError,
  decodeBookPayload,
  encodeBookPayload,
} from "./payload";

const FILES = [
  {
    path: "system.hcl",
    content: 'system "demo" {\n  description = "demo system"\n}\n',
  },
  {
    path: "diagrams/main.hcl",
    content: 'view "main" {\n  system = "demo"\n}\n',
  },
];

/** Test-only helper: deflate + base64url a raw JSON value, bypassing validation. */
async function encodeRawJson(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const stream = new Blob([bytes]).stream().pipeThrough(
    new CompressionStream("deflate"),
  );
  const compressed = new Uint8Array(
    await new Response(stream).arrayBuffer(),
  );
  let binary = "";
  for (const byte of compressed) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(
    /=+$/,
    "",
  );
}

describe("book-example payload codec", () => {
  it("round-trips files through encode/decode", async () => {
    const encoded = await encodeBookPayload(FILES);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    await expect(decodeBookPayload(encoded)).resolves.toEqual({
      version: 1,
      files: FILES,
    });
  });

  it("decodes a location-hash style '#p=' payload", async () => {
    const encoded = await encodeBookPayload(FILES);
    await expect(decodeBookPayload(`#p=${encoded}`)).resolves.toEqual({
      version: 1,
      files: FILES,
    });
  });

  it("rejects empty input", async () => {
    await expect(decodeBookPayload("")).rejects.toThrow(BookPayloadError);
  });

  it("rejects non-base64 garbage", async () => {
    await expect(decodeBookPayload("!!!not-valid!!!")).rejects.toThrow(
      BookPayloadError,
    );
  });

  it("rejects truncated deflate data", async () => {
    const encoded = await encodeBookPayload(FILES);
    const truncated = encoded.slice(0, Math.floor(encoded.length / 2));
    await expect(decodeBookPayload(truncated)).rejects.toThrow(
      BookPayloadError,
    );
  });

  it("rejects a well-formed payload with an unknown version", async () => {
    const encoded = await encodeRawJson({ version: 2, files: FILES });
    await expect(decodeBookPayload(encoded)).rejects.toThrow(
      BookPayloadError,
    );
  });

  it("rejects a well-formed payload with an absolute file path", async () => {
    const encoded = await encodeRawJson({
      version: 1,
      files: [{ path: "/etc/passwd.hcl", content: "x" }],
    });
    await expect(decodeBookPayload(encoded)).rejects.toThrow(
      BookPayloadError,
    );
  });

  it("rejects oversized input before decoding", async () => {
    await expect(decodeBookPayload("A".repeat(500_001))).rejects.toThrow(
      BookPayloadError,
    );
  });

  it("encode rejects an empty file list", async () => {
    await expect(encodeBookPayload([])).rejects.toThrow(BookPayloadError);
  });

  it("encode rejects absolute paths, traversal, and non-hcl files", async () => {
    const bad = [
      "/abs.hcl",
      "../escape.hcl",
      "diagrams/../escape.hcl",
      "notes.md",
    ];
    for (const path of bad) {
      await expect(
        encodeBookPayload([{ path, content: "x" }]),
      ).rejects.toThrow(BookPayloadError);
    }
  });
});
