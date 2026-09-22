import { describe, expect, it } from "vitest";
import {
  annotationSvgLineText,
  annotationSvgLines,
} from "./annotationMarkdown";

describe("annotationSvgLines", () => {
  it("renders plain text as a single line", () => {
    const lines = annotationSvgLines("New note");
    expect(lines).toHaveLength(1);
    expect(annotationSvgLineText(lines[0])).toBe("New note");
  });

  it("renders bold and italic inline spans", () => {
    const lines = annotationSvgLines("Hello **bold** and *it*");
    expect(lines).toHaveLength(1);
    const spans = lines[0].spans;
    expect(spans.find((s) => s.text === "bold")?.bold).toBe(true);
    expect(spans.find((s) => s.text === "it")?.italic).toBe(true);
    expect(annotationSvgLineText(lines[0])).toBe("Hello bold and it");
  });

  it("renders strikethrough, code and link spans", () => {
    const lines = annotationSvgLines("~~gone~~ `code` [label](https://x)");
    const flat = lines[0].spans;
    expect(flat.find((s) => s.text === "gone")?.strike).toBe(true);
    expect(flat.find((s) => s.text === "code")?.code).toBe(true);
    expect(flat.find((s) => s.text === "label")?.link).toBe(true);
    expect(annotationSvgLineText(lines[0])).toBe("gone code label");
  });

  it("renders headings with size + bold", () => {
    const lines = annotationSvgLines("# Title");
    expect(lines).toHaveLength(1);
    expect(lines[0].bold).toBe(true);
    expect(lines[0].size).toBeGreaterThan(1);
    expect(annotationSvgLineText(lines[0])).toBe("Title");
  });

  it("renders bullet and ordered lists with prefixes", () => {
    const bullets = annotationSvgLines("- a\n- b");
    // marked needs blank handling: "- a\n- b" lexes as one list block.
    expect(bullets.map(annotationSvgLineText)).toEqual(["• a", "• b"]);

    const ordered = annotationSvgLines("1. one\n2. two");
    expect(ordered.map(annotationSvgLineText)).toEqual(["1. one", "2. two"]);
  });

  it("renders blockquote and fenced code", () => {
    const quote = annotationSvgLines("> hello");
    expect(annotationSvgLineText(quote[0])).toContain("hello");
    expect(quote[0].quote).toBe(true);

    const code = annotationSvgLines("```js\nlet x = 1\n```");
    expect(code.some((l) => l.codeBlock)).toBe(true);
    expect(code.map(annotationSvgLineText).join("\n")).toContain("let x = 1");
  });

  it("degrades tables/images/html to plain text without throwing", () => {
    expect(() =>
      annotationSvgLines("| a | b |\n|---|---|\n| 1 | 2 |\n\n![alt](u)\n\n<div>hi</div>"),
    ).not.toThrow();
    const text = annotationSvgLines(
      "| a | b |\n|---|---|\n| 1 | 2 |",
    ).map(annotationSvgLineText).join("\n");
    expect(text).toContain("a | b");
  });

  it("requires a blank line for a new paragraph (standard markdown)", () => {
    const joined = annotationSvgLines("line1\nline2");
    expect(joined.map(annotationSvgLineText).join("\n")).toBe("line1\nline2");
    // Blank line lexes as paragraph/space/paragraph → separator row kept
    // for vertical rhythm (same as the legacy plain-text renderer).
    const split = annotationSvgLines("para one\n\npara two");
    expect(split.map(annotationSvgLineText)).toEqual(["para one", "", "para two"]);
  });

  it("never throws on hostile input", () => {
    expect(() => annotationSvgLines("**unclosed\n\n# \n\n- \n\n[bad](\n")).not.toThrow();
  });
});
