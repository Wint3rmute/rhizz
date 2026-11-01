// PoC edit identity for per-project locks (proposal 0004).
//
// The username is kept in `localStorage` and sent with each lock and write
// request; the server trusts it — there is no authentication. MCP clients
// never send one: they are hardcoded to `AI` server-side.
//
// Storage access goes through `safeStorage` (never raw `localStorage`):
// cross-site iframes with storage blocked must degrade to a fresh guest
// name per call instead of crashing module init.
import { safeGetItem, safeSetItem } from "../safeStorage";

/** The `localStorage` key holding the username. */
export const USERNAME_KEY = "rhizz-username";

/** The stored username, or null when none was chosen yet. Never throws. */
export function getUsername(): string | null {
  const raw = safeGetItem(USERNAME_KEY)?.trim();
  if (raw === undefined || raw === "") return null;
  return raw;
}

/** The stored username, creating and storing one on first use. Never throws. */
export function getOrCreateUsername(): string {
  const existing = getUsername();
  if (existing !== null) return existing;
  const suffix = Math.random().toString(16).slice(2, 10).padEnd(8, "0");
  const fresh = `guest-${suffix}`;
  safeSetItem(USERNAME_KEY, fresh);
  return fresh;
}
