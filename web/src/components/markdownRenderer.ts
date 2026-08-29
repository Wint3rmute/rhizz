// A thin wrapper around `marked` configured for rendering user-authored
// Markdown docs in the Explore hover popups.
//
// XSS note: marked does NOT sanitize by default — its `html()` renderer passes
// raw HTML through verbatim, and the rendered output is injected via
// `{@html}` in Markdown.svelte. Docs are user-authored (and rendered with no
// remote content), but we still neutralize raw HTML to text so a doc can't
// execute scripts against `document`. Overriding the `html` renderer to escape
// the source turns `<script>...</script>` into visible text instead of a live
// element.
import { marked, type Tokens } from "marked";

// Escapes the five HTML-significant characters so a raw HTML token renders as
// text rather than being injected into the DOM.
function escapeHtml(src: string): string {
  return src
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

marked.use({
  renderer: {
    html: (token: Tokens.HTML | Tokens.Tag) => escapeHtml(token.text),
  },
});

/** Renders Markdown to an HTML string safe for `{@html}` injection. */
export function renderMarkdown(md: string): string {
  return marked.parse(md, { async: false });
}
