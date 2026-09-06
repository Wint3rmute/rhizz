// Codec for the `book-example` route's URL payload (`#p=<...>`).
//
// A book project is a small list of `{ path, content }` HCL files, carried in
// the iframe URL's hash fragment (never the query — the payload must not hit
// server logs): JSON → deflate → base64url. The preprocessor generates these
// URLs at `just book` time; this module only encodes/decodes them. Both sides
// validate with zod so a hand-crafted URL can never inject an unexpected
// shape (absolute paths, `..` traversal, huge blobs) into the page.
import { z } from "zod";

export const BOOK_PAYLOAD_VERSION = 1 as const;
export const MAX_BOOK_PAYLOAD_FILES = 64;
export const MAX_BOOK_FILE_PATH_LENGTH = 256;
export const MAX_BOOK_FILE_CONTENT_LENGTH = 200_000;

/** Hard cap on the encoded string, checked before any decoding work. */
const MAX_ENCODED_LENGTH = 500_000;

function isSafeHclPath(path: string): boolean {
  if (!path.endsWith(".hcl")) return false;
  if (path.startsWith("/") || path.startsWith("\\")) return false;
  return !path.split("/").some((segment) =>
    segment === "" || segment === "." || segment === ".."
  );
}

const BookPayloadFileSchema = z.object({
  path: z.string().min(1).max(MAX_BOOK_FILE_PATH_LENGTH).refine(
    isSafeHclPath,
    { message: "path must be a relative .hcl path without '..' segments" },
  ),
  content: z.string().max(MAX_BOOK_FILE_CONTENT_LENGTH),
});

const BookPayloadSchema = z.object({
  version: z.literal(BOOK_PAYLOAD_VERSION),
  files: z.array(BookPayloadFileSchema).min(1).max(MAX_BOOK_PAYLOAD_FILES),
});

export type BookPayloadFile = z.infer<typeof BookPayloadFileSchema>;
export type BookPayload = z.infer<typeof BookPayloadSchema>;

export class BookPayloadError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(`Invalid book payload: ${message}`, options);
    this.name = "BookPayloadError";
  }
}

function issueDetail(error: z.ZodError): string {
  const first = error.issues.at(0);
  if (!first) return "unknown validation failure";
  const where = first.path.length > 0 ? `${first.path.join(".")}: ` : "";
  return `${where}${first.message}`;
}

async function deflateRaw(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(
    new CompressionStream("deflate"),
  );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function inflateRaw(data: Uint8Array<ArrayBuffer>): Promise<string> {
  const stream = new Blob([data]).stream().pipeThrough(
    new DecompressionStream("deflate"),
  );
  return await new Response(stream).text();
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(
    /=+$/,
    "",
  );
}

function base64UrlToBytes(raw: string): Uint8Array<ArrayBuffer> {
  if (raw.length === 0 || !/^[A-Za-z0-9_-]*$/.test(raw)) {
    throw new BookPayloadError("not base64url-encoded");
  }
  let base64 = raw.replaceAll("-", "+").replaceAll("_", "/");
  const remainder = base64.length % 4;
  if (remainder === 1) throw new BookPayloadError("bad base64url length");
  if (remainder > 0) base64 += "=".repeat(4 - remainder);
  let binary: string;
  try {
    binary = atob(base64);
  } catch (error) {
    throw new BookPayloadError("not base64url-encoded", { cause: error });
  }
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** Validate + compress a file list into a URL-fragment-safe string. */
export async function encodeBookPayload(
  files: BookPayloadFile[],
): Promise<string> {
  const parsed = BookPayloadSchema.safeParse({
    version: BOOK_PAYLOAD_VERSION,
    files,
  });
  if (!parsed.success) {
    throw new BookPayloadError(issueDetail(parsed.error));
  }
  const compressed = await deflateRaw(
    new TextEncoder().encode(JSON.stringify(parsed.data)),
  );
  return bytesToBase64Url(compressed);
}

/**
 * Decode a `#p=<...>` fragment (or the bare encoded string) back into a
 * validated file list. Throws {@link BookPayloadError} on any failure.
 */
export async function decodeBookPayload(raw: string): Promise<BookPayload> {
  const encoded = raw.startsWith("#p=") ? raw.slice(3) : raw;
  if (encoded.length === 0) throw new BookPayloadError("empty payload");
  if (encoded.length > MAX_ENCODED_LENGTH) {
    throw new BookPayloadError(
      `payload too large (${String(encoded.length)} chars)`,
    );
  }
  const compressed = base64UrlToBytes(encoded);
  let json: string;
  try {
    json = await inflateRaw(compressed);
  } catch (error) {
    throw new BookPayloadError("not deflate-compressed JSON", {
      cause: error,
    });
  }
  let data: unknown;
  try {
    data = JSON.parse(json) as unknown;
  } catch (error) {
    throw new BookPayloadError("not JSON", { cause: error });
  }
  const parsed = BookPayloadSchema.safeParse(data);
  if (!parsed.success) {
    throw new BookPayloadError(issueDetail(parsed.error));
  }
  return parsed.data;
}
