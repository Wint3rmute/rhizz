import { describe, expect, it } from "vitest";
import {
  codeLocationQuery,
  diagnosticLocation,
  parseLineParam,
} from "./diagnosticLocation";

describe("diagnosticLocation", () => {
  it("labels a file and line as file:line", () => {
    expect(diagnosticLocation({ file: "system.hcl", line: 14 })).toEqual({
      file: "system.hcl",
      line: 14,
      label: "system.hcl:14",
    });
  });

  it("labels a file without a line by its path alone", () => {
    expect(diagnosticLocation({ file: "views/main.hcl" })).toEqual({
      file: "views/main.hcl",
      line: null,
      label: "views/main.hcl",
    });
  });

  it("has no location without a file", () => {
    expect(diagnosticLocation({})).toBeNull();
    expect(diagnosticLocation({ file: "", line: 3 })).toBeNull();
    expect(diagnosticLocation({ file: null, line: null })).toBeNull();
  });
});

describe("codeLocationQuery", () => {
  it("names the file and the line", () => {
    expect(codeLocationQuery({ file: "system.hcl", line: 14 })).toBe(
      "?file=system.hcl&line=14",
    );
  });

  it("encodes nested paths and omits a missing line", () => {
    expect(codeLocationQuery({ file: "views/a b.hcl", line: null })).toBe(
      "?file=views%2Fa+b.hcl",
    );
  });
});

describe("parseLineParam", () => {
  it("reads a positive line number", () => {
    expect(parseLineParam("14")).toBe(14);
    expect(parseLineParam("1")).toBe(1);
  });

  it("rejects anything else", () => {
    for (const value of [null, "", "0", "-3", "2.5", "abc", "14abc"]) {
      expect(parseLineParam(value)).toBeNull();
    }
  });
});
