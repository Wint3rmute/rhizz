import { describe, expect, it } from "vitest";
import { fetchBuildInfo } from "./buildInfo";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("fetchBuildInfo", () => {
  it("reads the git sha from /api/version under the base url", async () => {
    const requested: string[] = [];
    const info = await fetchBuildInfo("https://rhizz.example/", (url) => {
      requested.push(
        typeof url === "string"
          ? url
          : url instanceof URL
            ? url.href
            : url.url,
      );
      return Promise.resolve(jsonResponse({ git_sha: "07265fb" }));
    });
    expect(requested).toEqual(["https://rhizz.example/api/version"]);
    expect(info).toEqual({ git_sha: "07265fb" });
  });

  it("returns null when the server answers with an error status", async () => {
    const info = await fetchBuildInfo("http://x", () =>
      Promise.resolve(jsonResponse({}, 500)),
    );
    expect(info).toBeNull();
  });

  it("returns null when the body is not a version payload", async () => {
    const info = await fetchBuildInfo("http://x", () =>
      Promise.resolve(jsonResponse({ something: "else" })),
    );
    expect(info).toBeNull();
  });

  it("returns null when the request fails", async () => {
    const info = await fetchBuildInfo("http://x", () =>
      Promise.reject(new TypeError("network down")),
    );
    expect(info).toBeNull();
  });
});
