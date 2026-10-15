import type { FetchLike } from "./vfs/vfsStore";

/**
 * Commit the rhizz server was built from, as reported by `GET /api/version`.
 * `dev` for local builds; `unknown` when the flake had no git revision.
 */
export interface BuildInfo {
  git_sha: string;
}

/**
 * Asks the server which commit it was built from. Resolves `null` when the
 * server is unreachable or answers with something other than the expected
 * shape, so the UI can simply omit the version rather than fail.
 */
export async function fetchBuildInfo(
  baseUrl: string,
  fetchImpl: FetchLike = globalThis.fetch,
): Promise<BuildInfo | null> {
  const origin = baseUrl.replace(/\/+$/, "");
  try {
    const response = await fetchImpl(`${origin}/api/version`);
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (
      typeof body === "object" &&
      body !== null &&
      "git_sha" in body &&
      typeof body.git_sha === "string"
    ) {
      return { git_sha: body.git_sha };
    }
    return null;
  } catch {
    return null;
  }
}
