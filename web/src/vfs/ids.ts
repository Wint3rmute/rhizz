// Client-side id generation for VFS nodes (files, directories).
//
// These ids are minted in the browser at creation time, so the generator
// must work everywhere the app runs — including plain http, which is not a
// secure context. `crypto.randomUUID()` requires a secure context (https,
// localhost, `file://`) and is `undefined` over http, where project creation
// used to crash with "crypto.randomUUID is not a function".
// `crypto.getRandomValues()`, by contrast, is available in insecure contexts,
// so it is the primary fallback; `Math.random` is the last resort for
// environments without WebCrypto at all (uniqueness is still ample at the
// scale of a handful of projects).
function uuidFromBytes(bytes: Uint8Array): string {
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** A UUIDv4, generated without requiring a secure context. */
export function generateId(): string {
  const cryptoObj = globalThis.crypto as Crypto | undefined;
  if (typeof cryptoObj?.randomUUID === "function") {
    try {
      return cryptoObj.randomUUID();
    } catch {
      // Fall through to the context-independent generators below.
    }
  }
  if (typeof cryptoObj?.getRandomValues === "function") {
    return uuidFromBytes(cryptoObj.getRandomValues(new Uint8Array(16)));
  }
  const bytes = new Uint8Array(16);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return uuidFromBytes(bytes);
}
