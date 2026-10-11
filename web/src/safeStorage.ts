// Storage access that never throws.
//
// `typeof localStorage === "undefined"` only guards server-side rendering.
// In the browser, touching `localStorage` can still throw a SecurityError:
// cross-site iframes with third-party storage blocked (Safari by default,
// Chrome/Firefox/Brave under strict tracking protection) deny even reading
// the binding, as does private browsing in some browsers. The book embeds
// (`/book-example` iframed from the mdBook site) run exactly in that
// context, so every persistence call site must go through here — otherwise
// module init throws and the whole page renders only its empty background.
//
// Contract: reads degrade to "missing" (null), writes/removes degrade to
// no-ops. The app keeps working without persistence instead of crashing.
function storage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    // Touch the binding inside the try: the getter itself can throw.
    return localStorage;
  } catch {
    return null;
  }
}

/** The working `localStorage`, or null when unavailable (never throws). */
export function getSafeStorage(): Storage | null {
  return storage();
}

/** Read a key, or null when storage is unavailable (never throws). */
export function safeGetItem(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Write a key; silently dropped when storage is unavailable (never throws). */
export function safeSetItem(key: string, value: string): void {
  try {
    storage()?.setItem(key, value);
  } catch {
    // Persistence unavailable: the app runs without it.
  }
}

/** Remove a key; silently dropped when storage is unavailable (never throws). */
export function safeRemoveItem(key: string): void {
  try {
    storage()?.removeItem(key);
  } catch {
    // Persistence unavailable: nothing to forget.
  }
}
