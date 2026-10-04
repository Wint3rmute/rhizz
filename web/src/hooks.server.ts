import type { Handle } from "@sveltejs/kit/hooks";

// The browser JS self-profiler (see `hooks.client.ts`'s
// `browserProfilingIntegration`) only starts when the document response
// carries `Document-Policy: js-profiling`. SvelteKit serves every document
// through this hook in dev, so the header is set here; production documents
// are served as static files by `rhizz-server` (see
// `crates/rhizz-server/src/server.rs`), which sets the same header itself.
export const handle: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);
  response.headers.set("Document-Policy", "js-profiling");
  return response;
};
