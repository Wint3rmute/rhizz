import { describe, expect, it } from "vitest";
import { renderMarkdown, renderMarkdownInline } from "./markdownRenderer";

describe("renderMarkdown", () => {
  it("renders headings", () => {
    const html = renderMarkdown("# Title\n\n## Subtitle");
    expect(html).toContain("<h1");
    expect(html).toContain("Title");
    expect(html).toContain("<h2");
    expect(html).toContain("Subtitle");
  });

  it("renders paragraphs and emphasis", () => {
    const html = renderMarkdown("Hello **bold** and *italic*.");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
  });

  it("renders inline code and fenced code blocks", () => {
    const html = renderMarkdown("Use `code` here.\n\n```\nconst x = 1;\n```");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain("<pre>");
    expect(html).toContain("const x = 1;");
  });

  it("renders unordered lists", () => {
    const html = renderMarkdown("- one\n- two\n- three");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<li>three</li>");
  });

  it("renders links", () => {
    const html = renderMarkdown("[rhizz](https://example.com)");
    expect(html).toContain(
      '<a target="_blank" rel="noopener" href="https://example.com">rhizz</a>',
    );
  });

  it("opens links in a new tab", () => {
    const html = renderMarkdown("[rhizz](https://example.com)");
    const link = /<a [^>]*>rhizz<\/a>/.exec(html)?.[0] ?? "";
    expect(link).toContain('target="_blank"');
    expect(link).toContain('rel="noopener"');
  });

  it("opens autolinks in a new tab", () => {
    const html = renderMarkdown("<https://example.com>");
    expect(html).toContain('target="_blank"');
  });

  it("keeps link titles when opening in a new tab", () => {
    const html = renderMarkdown('[rhizz](https://example.com "home")');
    expect(html).toContain('title="home"');
    expect(html).toContain('target="_blank"');
  });

  it("escapes raw HTML instead of injecting it", () => {
    const html = renderMarkdown("<script>alert('x')</script>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes HTML inside otherwise-valid markdown", () => {
    const html = renderMarkdown("Hello <img src=x onerror=alert(1)> world");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});

describe("diagnostic messages", () => {
  it("renders backticked entity names as monospace code", () => {
    const html = renderMarkdown(
      "connection `uart-link` references undefined component `gps`",
    );
    expect(html).toContain("<code>uart-link</code>");
    expect(html).toContain("<code>gps</code>");
    expect(html).not.toContain("`");
  });

  it("keeps single-quoted keywords as plain text", () => {
    const html = renderMarkdown(
      "connection `c` has 'from' and 'to' pointing to the same component",
    );
    expect(html).toContain("&#39;from&#39; and &#39;to&#39;");
    expect(html).not.toContain("<code>from</code>");
  });

  it("escapes HTML-looking entity names inside code spans", () => {
    const html = renderMarkdown(
      "component `<img src=x onerror=alert(1)>` is missing a full_name",
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("renders inline markdown without a block wrapper", () => {
    const html = renderMarkdownInline("port `tx` is not referenced");
    expect(html).toBe("port <code>tx</code> is not referenced");
  });
});
