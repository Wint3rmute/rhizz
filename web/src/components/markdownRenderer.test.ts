import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdownRenderer";

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
    expect(html).toContain('<a href="https://example.com">rhizz</a>');
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
