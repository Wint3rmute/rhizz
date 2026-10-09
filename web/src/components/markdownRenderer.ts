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
import { marked, Renderer, type Tokens } from "marked";

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

// Default `<a>` rendering, so href sanitization and title handling stay
// identical to marked's own output.
// `marked.use` invokes the override with `this` set to the live renderer,
// and the default implementation needs `this.parser` to render the link
// text — hence the explicit `this` parameter instead of a detached method.
function renderDefaultLink(this: Renderer, token: Tokens.Link): string {
  return Renderer.prototype.link.call(this, token);
}

marked.use({
  renderer: {
    html: (token: Tokens.HTML | Tokens.Tag) => escapeHtml(token.text),
    // Open doc links in a new tab: docs render inside the app, and following
    // a link must not navigate the workspace away. `noopener` keeps the new
    // page from reaching back via `window.opener`.
    link(token: Tokens.Link): string {
      return renderDefaultLink
        .call(this, token)
        .replace(/^<a /, '<a target="_blank" rel="noopener" ');
    },
  },
});

/** Renders Markdown to an HTML string safe for `{@html}` injection. */
export function renderMarkdown(md: string): string {
  return marked.parse(md, { async: false });
}
