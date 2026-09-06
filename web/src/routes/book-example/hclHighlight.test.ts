import { describe, expect, it } from "vitest";
import { highlightHcl } from "./hclHighlight";

describe("hclHighlight", () => {
  it("marks block keywords and label strings", () => {
    const tokens = highlightHcl('system "demo" {');
    expect(tokens.map((token) => token.cls)).toEqual([
      "keyword",
      "plain",
      "string",
      "plain",
    ]);
    expect(tokens.map((token) => token.text).join("")).toBe(
      'system "demo" {',
    );
  });

  it("treats full-line and trailing comments as comments", () => {
    expect(highlightHcl("# a comment")).toEqual([
      { text: "# a comment", cls: "comment" },
    ]);
    expect(highlightHcl("// another")).toEqual([
      { text: "// another", cls: "comment" },
    ]);
    const tokens = highlightHcl("x = 1 # trailing");
    expect(tokens.at(-1)).toEqual({ text: "# trailing", cls: "comment" });
  });

  it("does not treat # inside strings as a comment", () => {
    expect(highlightHcl('"a#b"')).toEqual([
      { text: '"a#b"', cls: "string" },
    ]);
  });

  it("keeps escaped quotes inside one string token", () => {
    expect(highlightHcl('"a\\"b" + "c"')).toEqual([
      { text: '"a\\"b"', cls: "string" },
      { text: " + ", cls: "plain" },
      { text: '"c"', cls: "string" },
    ]);
  });

  it("marks attribute keys before =", () => {
    const tokens = highlightHcl('  description = "d"');
    expect(tokens).toEqual([
      { text: "  ", cls: "plain" },
      { text: "description", cls: "attr" },
      { text: " = ", cls: "plain" },
      { text: '"d"', cls: "string" },
    ]);
  });

  it("marks numbers and booleans", () => {
    const tokens = highlightHcl("x = 16\ny = 1.5\nleaf = true");
    const classes = tokens.map((token) => token.cls);
    expect(classes).toContain("number");
    expect(tokens.map((token) => token.text).join("")).toBe(
      "x = 16\ny = 1.5\nleaf = true",
    );
  });

  it("round-trips realistic HCL losslessly", () => {
    const source = [
      'protocol "temp-bus" {',
      "  # sensor bus",
      '  roles = ["provider", "consumer"]',
      "",
      '  message "reading" {',
      '    field "celsius" {',
      '      type = "f32"',
      "    }",
      "  }",
      "}",
      "",
      'component "sensor" {',
      '  description = "Temperature sensor"',
      "  leaf = true",
      "}",
    ].join("\n");
    expect(highlightHcl(source).map((token) => token.text).join("")).toBe(
      source,
    );
  });
});
