// Minimal HCL syntax highlighting for the book embed's read-only code
// view. Deliberately dependency-free (highlight.js/Monaco are far too heavy
// for an iframe embed): a small line scanner emitting plain-text tokens with
// a CSS class each. Rendered with Svelte `{text}` interpolation (never
// `{@html}`), so token text is always HTML-escaped.
//
// Covers the rhizz subset: `#`/`//` comments, `"..."` strings with escapes,
// block keywords, `key =` attributes, numbers and booleans. Multi-line
// heredocs are not special-cased (none of the book examples use them).

export type HclTokenClass =
  | "keyword"
  | "string"
  | "comment"
  | "number"
  | "attr"
  | "plain";

export interface HclToken {
  text: string;
  cls: HclTokenClass;
}

const KEYWORDS: ReadonlySet<string> = new Set([
  "annotation",
  "component",
  "connection",
  "field",
  "filter",
  "instance",
  "message",
  "node",
  "port",
  "project",
  "protocol",
  "system",
  "view",
]);

const LITERALS: ReadonlySet<string> = new Set(["true", "false"]);

function isWordStart(ch: string): boolean {
  return /[A-Za-z_]/.test(ch);
}

function isWordChar(ch: string): boolean {
  return /[A-Za-z0-9_-]/.test(ch);
}

function highlightLine(line: string, out: HclToken[]): void {
  let plain = "";
  const flushPlain = (): void => {
    if (plain !== "") {
      out.push({ text: plain, cls: "plain" });
      plain = "";
    }
  };
  let i = 0;
  while (i < line.length) {
    const rest = line.slice(i);
    if (rest.startsWith("#") || rest.startsWith("//")) {
      flushPlain();
      out.push({ text: rest, cls: "comment" });
      return;
    }
    const ch = line[i];
    if (ch === '"') {
      flushPlain();
      let end = i + 1;
      while (end < line.length) {
        if (line[end] === "\\") {
          end += 2;
        } else if (line[end] === '"') {
          end += 1;
          break;
        } else {
          end += 1;
        }
      }
      out.push({ text: line.slice(i, end), cls: "string" });
      i = end;
      continue;
    }
    if (ch !== undefined && isWordStart(ch)) {
      let end = i + 1;
      while (end < line.length && isWordChar(line[end] ?? "")) end += 1;
      const word = line.slice(i, end);
      const after = line.slice(end);
      if (KEYWORDS.has(word)) {
        flushPlain();
        out.push({ text: word, cls: "keyword" });
      } else if (LITERALS.has(word)) {
        flushPlain();
        out.push({ text: word, cls: "number" });
      } else if (/^[ \t]*=/.test(after)) {
        flushPlain();
        out.push({ text: word, cls: "attr" });
      } else {
        plain += word;
      }
      i = end;
      continue;
    }
    if (ch !== undefined && /[0-9]/.test(ch)) {
      flushPlain();
      let end = i + 1;
      while (end < line.length && /[0-9A-Za-z_.]/.test(line[end] ?? "")) {
        end += 1;
      }
      out.push({ text: line.slice(i, end), cls: "number" });
      i = end;
      continue;
    }
    plain += ch ?? "";
    i += 1;
  }
  flushPlain();
}

/** Split `source` into highlighted tokens; joining all texts yields `source`. */
export function highlightHcl(source: string): HclToken[] {
  const out: HclToken[] = [];
  const lines = source.split("\n");
  lines.forEach((line, index) => {
    highlightLine(line, out);
    if (index < lines.length - 1) out.push({ text: "\n", cls: "plain" });
  });
  return out;
}
