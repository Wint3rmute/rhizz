// Markdown annotations → SVG-safe lines.
//
// Annotations stay plain `text` strings end-to-end (core schema, HCL,
// persistence untouched). This module is the *presentation* layer: it parses
// the text with the repo's existing `marked` dependency (dedicated `Marked`
// instance, so docs rendering via the global `marked.parse` is unaffected)
// and flattens tokens into SVG-renderable lines of styled spans.
//
// Deliberately zero Svelte/DOM dependency — unit-testable in plain Node,
// same pattern as `geometry.ts`.
//
// Supported subset (pragmatic): headings, bullet/ordered lists (nest cap 2),
// bold/italic/strikethrough/inline-code/link, blockquote, fenced code.
// Tables, images, raw HTML degrade to plain text — never throw.
import { Marked } from "marked";

// Isolated instance: `breaks: false` = standard Markdown (blank line needed
// for a new paragraph), matching the confirmed UX. Global docs rendering
// (`markdownRenderer.ts`) is untouched.
const annotationMarked = new Marked({ breaks: false, gfm: true });

/** One styled run inside an SVG line. */
export interface AnnotationSpan {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
  link?: boolean;
}

/** One SVG-renderable line: spans + block-level presentation hints. */
export interface AnnotationSvgLine {
  spans: AnnotationSpan[];
  /** Font-size multiplier (headings). 1 = base size. */
  size?: number;
  /** Whole-line bold (headings). */
  bold?: boolean;
  /** Nest/quote indent level → x-offset steps in the renderer. */
  indent?: number;
  /** Monospace line (fenced code). */
  codeBlock?: boolean;
  /** Quotation line. */
  quote?: boolean;
}

/** Max list/quote nesting depth rendered as indent; deeper levels flatten. */
export const ANNOTATION_MD_MAX_INDENT = 2;
/** Pixels of x-offset per indent level at 1x scale (renderer multiplies by scale). */
export const ANNOTATION_MD_INDENT_PX = 12;
/** Heading font-size multipliers by depth (1–6). */
const HEADING_SIZES = [1.5, 1.3, 1.15, 1, 1, 1];

/**
 * Structural view of a marked token — only the fields the mapper reads.
 * The lexer output is cast here (marked's own `Tokens.*` types trip the
 * repo's `no-unsafe-*` lint rules), so all fields stay optional and every
 * access is guarded.
 */
interface LexToken {
  type: string;
  raw?: string;
  text?: string;
  depth?: number;
  ordered?: boolean;
  start?: string | number;
  href?: string;
  items?: LexToken[];
  tokens?: LexToken[];
  header?: LexToken[];
  rows?: LexToken[][];
  cells?: LexToken[];
}

type SpanStyle = Omit<AnnotationSpan, "text">;

function styled(text: string, style: SpanStyle = {}): AnnotationSpan[] {
  return text === "" ? [] : [{ text, ...style }];
}

function inlineText(tokens: LexToken[] | undefined): string {
  if (tokens === undefined) return "";
  return tokens
    .map((t) => {
      switch (t.type) {
        case "text":
        case "escape":
          return t.text ?? "";
        case "strong":
        case "em":
        case "del":
          return inlineText(t.tokens);
        case "codespan":
          return t.text ?? "";
        case "link": {
          const inner = inlineText(t.tokens);
          if (inner !== "") return inner;
          return t.text ?? t.href ?? "";
        }
        case "image":
          return t.text ?? "";
        case "br":
          return "\n";
        default:
          return t.text ?? "";
      }
    })
    .join("");
}

function inlineSpans(
  tokens: LexToken[] | undefined,
  style: SpanStyle = {},
): AnnotationSpan[] {
  const out: AnnotationSpan[] = [];
  for (const t of tokens ?? []) {
    switch (t.type) {
      case "text":
      case "escape":
        out.push(...styled(t.text ?? "", style));
        break;
      case "strong":
        out.push(...inlineSpans(t.tokens, { ...style, bold: true }));
        break;
      case "em":
        out.push(...inlineSpans(t.tokens, { ...style, italic: true }));
        break;
      case "del":
        out.push(...inlineSpans(t.tokens, { ...style, strike: true }));
        break;
      case "codespan":
        out.push(...styled(t.text ?? "", { ...style, code: true }));
        break;
      case "link": {
        const inner = inlineSpans(t.tokens, { ...style, link: true });
        out.push(
          ...(inner.length > 0
            ? inner
            : styled(t.text ?? t.href ?? "", { ...style, link: true })),
        );
        break;
      }
      case "image":
        out.push(...styled(t.text ?? "", style));
        break;
      case "br":
        // Soft break inside a paragraph: split the current line.
        out.push({ text: "\n" });
        break;
      default:
        out.push(...styled(t.text ?? "", style));
        break;
    }
  }
  return out;
}

/** Split spans on embedded `\n` (from `<br>`) into multiple span runs. */
function splitLines(spans: AnnotationSpan[]): AnnotationSpan[][] {
  const lines: AnnotationSpan[][] = [[]];
  for (const s of spans) {
    const parts = s.text.split("\n");
    parts.forEach((part, i) => {
      if (i > 0) lines.push([]);
      const current = lines[lines.length - 1];
      if (part !== "" && current !== undefined) {
        current.push({ ...s, text: part });
      }
    });
  }
  return lines;
}

function prefixSpan(text: string): AnnotationSpan {
  return { text };
}

function blockLines(
  token: LexToken,
  indent: number,
  out: AnnotationSvgLine[],
): void {
  const capped = Math.min(indent, ANNOTATION_MD_MAX_INDENT);
  switch (token.type) {
    case "space":
      out.push({ spans: [] });
      break;
    case "heading": {
      const depth = token.depth ?? 1;
      const size = HEADING_SIZES[Math.max(0, Math.min(5, depth - 1))] ?? 1;
      for (const parts of splitLines(inlineSpans(token.tokens))) {
        out.push({ spans: parts, size, bold: true, indent: capped });
      }
      break;
    }
    case "paragraph": {
      for (const parts of splitLines(inlineSpans(token.tokens))) {
        out.push({ spans: parts, indent: capped });
      }
      break;
    }
    case "text": {
      const inner = token.tokens !== undefined
        ? inlineSpans(token.tokens)
        : styled(token.text ?? "");
      for (const parts of splitLines(inner)) {
        out.push({ spans: parts, indent: capped });
      }
      break;
    }
    case "list": {
      const ordered = token.ordered ?? false;
      const startNum = typeof token.start === "number"
        ? token.start
        : Number.parseInt(token.start ?? "1", 10);
      const base = Number.isNaN(startNum) ? 1 : startNum;
      (token.items ?? []).forEach((item, i) => {
        const bullet = ordered ? `${(base + i).toString()}. ` : "• ";
        itemBlockLines(item, bullet, capped, out);
      });
      break;
    }
    case "blockquote": {
      const start = out.length;
      for (const t of token.tokens ?? []) blockLines(t, capped, out);
      for (let i = start; i < out.length; i++) {
        const line = out[i];
        if (line !== undefined) {
          line.quote = true;
          line.indent = Math.min(
            (line.indent ?? capped) + 1,
            ANNOTATION_MD_MAX_INDENT + 1,
          );
          line.spans = [prefixSpan("│ "), ...line.spans];
        }
      }
      if (out.length === start) {
        out.push({
          spans: [prefixSpan("│ ")],
          quote: true,
          indent: capped + 1,
        });
      }
      break;
    }
    case "code": {
      for (const row of (token.text ?? "").split("\n")) {
        out.push({
          spans: row === "" ? [] : [{ text: row, code: true }],
          codeBlock: true,
          indent: capped,
        });
      }
      break;
    }
    case "hr":
      out.push({ spans: [prefixSpan("───")] });
      break;
    case "table": {
      // Graceful degradation: header + rows as pipe-joined plain text.
      const row = (cells: LexToken[] | undefined) =>
        (cells ?? []).map((c) => inlineText(c.tokens)).join(" | ");
      out.push({ spans: styled(row(token.header)) });
      for (const r of token.rows ?? []) out.push({ spans: styled(row(r)) });
      break;
    }
    case "html":
      out.push({ spans: styled(token.text ?? "") });
      break;
    default: {
      const inner = inlineText(token.tokens);
      const text = inner !== "" ? inner : (token.text ?? token.raw ?? "");
      out.push({ spans: styled(text) });
      break;
    }
  }
}

function itemBlockLines(
  item: LexToken,
  bullet: string,
  indent: number,
  out: AnnotationSvgLine[],
): void {
  let first = true;
  const nested: LexToken[] = [];
  for (const t of item.tokens ?? []) {
    if (t.type === "list") {
      nested.push(t);
      continue;
    }
    const start = out.length;
    blockLines(t, indent, out);
    for (let i = start; i < out.length; i++) {
      const line = out[i];
      if (line === undefined) continue;
      if (first && i === start) {
        line.spans = [prefixSpan(bullet), ...line.spans];
        first = false;
      } else if (i === start) {
        line.spans = [prefixSpan("  "), ...line.spans];
      }
    }
    if (out.length === start) {
      out.push({ spans: [prefixSpan(bullet)], indent });
      first = false;
    }
  }
  for (const n of nested) blockLines(n, indent + 1, out);
}

/**
 * Parse annotation Markdown into SVG-renderable lines. Never throws —
 * lexer failures fall back to plain lines so a note always renders.
 */
export function annotationSvgLines(text: string): AnnotationSvgLine[] {
  if (text === "") return [{ spans: [] }];
  let tokens: LexToken[];
  try {
    tokens = annotationMarked.lexer(text) as unknown as LexToken[];
  } catch {
    return text.split("\n").map((t) => ({
      spans: t === "" ? [] : [{ text: t }],
    }));
  }
  const out: AnnotationSvgLine[] = [];
  for (const t of tokens) blockLines(t, 0, out);
  return out.length > 0 ? out : [{ spans: [] }];
}

/** Plain rendered text of one line (Markdown syntax stripped) — for geometry. */
export function annotationSvgLineText(line: AnnotationSvgLine): string {
  return line.spans.map((s) => s.text).join("");
}
