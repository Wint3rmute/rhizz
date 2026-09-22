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
import { Marked, type Tokens } from "marked";

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

type InlineToken = Tokens.InlineTokens | Tokens.Text;

function styled(text: string, style: Omit<AnnotationSpan, "text"> = {}): AnnotationSpan[] {
  return text ? [{ text, ...style }] : [];
}

function inlineText(tokens: InlineToken[] | undefined): string {
  if (!tokens) return "";
  return tokens.map((t) => {
    switch (t.type) {
      case "text":
      case "escape":
        return (t as Tokens.Text | Tokens.Escape).text ?? "";
      case "strong":
      case "em":
      case "del":
        return inlineText((t as Tokens.Strong | Tokens.Em | Tokens.Del).tokens);
      case "codespan":
        return (t as Tokens.Codespan).text ?? "";
      case "link":
        return inlineText((t as Tokens.Link).tokens);
      case "image":
        return (t as Tokens.Image).text ?? "";
      case "br":
        return "\n";
      default:
        return (t as { text?: string }).text ?? "";
    }
  }).join("");
}

function inlineSpans(
  tokens: InlineToken[] | undefined,
  style: Omit<AnnotationSpan, "text"> = {},
): AnnotationSpan[] {
  const out: AnnotationSpan[] = [];
  for (const t of tokens ?? []) {
    switch (t.type) {
      case "text":
      case "escape":
        out.push(...styled((t as Tokens.Text | Tokens.Escape).text ?? "", style));
        break;
      case "strong":
        out.push(
          ...inlineSpans((t as Tokens.Strong).tokens, { ...style, bold: true }),
        );
        break;
      case "em":
        out.push(
          ...inlineSpans((t as Tokens.Em).tokens, { ...style, italic: true }),
        );
        break;
      case "del":
        out.push(
          ...inlineSpans((t as Tokens.Del).tokens, { ...style, strike: true }),
        );
        break;
      case "codespan":
        out.push(...styled((t as Tokens.Codespan).text ?? "", { ...style, code: true }));
        break;
      case "link": {
        const lt = t as Tokens.Link;
        const inner = inlineSpans(lt.tokens, { ...style, link: true });
        out.push(...(inner.length > 0 ? inner : styled(lt.text ?? lt.href ?? "", { ...style, link: true })));
        break;
      }
      case "image":
        out.push(...styled((t as Tokens.Image).text ?? "", style));
        break;
      case "br":
        // Soft break inside a paragraph: split the current line.
        out.push({ text: "\n" });
        break;
      default:
        out.push(...styled((t as { text?: string }).text ?? "", style));
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
      if (part) lines[lines.length - 1].push({ ...s, text: part });
    });
  }
  return lines;
}

function prefixSpan(text: string, base: Omit<AnnotationSpan, "text"> = {}): AnnotationSpan {
  return { text, ...base };
}

function blockLines(
  token: Tokens.GenericToken,
  indent: number,
  out: AnnotationSvgLine[],
): void {
  const capped = Math.min(indent, ANNOTATION_MD_MAX_INDENT);
  switch (token.type) {
    case "space":
      out.push({ spans: [] });
      break;
    case "heading": {
      const h = token as Tokens.Heading;
      const spans = inlineSpans(h.tokens);
      for (const parts of splitLines(spans)) {
        out.push({
          spans: parts.length > 0 ? parts : [],
          size: HEADING_SIZES[Math.max(0, Math.min(5, h.depth - 1))],
          bold: true,
          indent: capped,
        });
      }
      break;
    }
    case "paragraph": {
      const p = token as Tokens.Paragraph;
      for (const parts of splitLines(inlineSpans(p.tokens))) {
        out.push({ spans: parts, indent: capped });
      }
      break;
    }
    case "text": {
      // Loose-list text / fallback block text.
      const t = token as Tokens.Text;
      const inner = t.tokens ? inlineSpans(t.tokens) : styled(t.text ?? "");
      for (const parts of splitLines(inner)) {
        out.push({ spans: parts, indent: capped });
      }
      break;
    }
    case "list": {
      const l = token as Tokens.List;
      l.items.forEach((item, i) => {
        const bullet = l.ordered ? `${l.start !== "" ? Number(l.start) + i : i + 1}. ` : "• ";
        itemBlockLines(item, bullet, capped, out, l.ordered ? 0 : undefined);
      });
      break;
    }
    case "blockquote": {
      const b = token as Tokens.Blockquote;
      const start = out.length;
      for (const t of b.tokens ?? []) blockLines(t as Tokens.GenericToken, capped, out);
      for (let i = start; i < out.length; i++) {
        const line = out[i];
        line.quote = true;
        line.indent = Math.min((line.indent ?? capped) + 1, ANNOTATION_MD_MAX_INDENT + 1);
        line.spans = [prefixSpan("│ "), ...line.spans];
      }
      if (out.length === start) out.push({ spans: [prefixSpan("│ ")], quote: true, indent: capped + 1 });
      break;
    }
    case "code": {
      const c = token as Tokens.Code;
      const rows = (c.text ?? "").split("\n");
      for (const row of rows) {
        out.push({
          spans: row ? [{ text: row, code: true }] : [],
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
      const t = token as Tokens.Table;
      const row = (cells: Tokens.TableCell[]) => cells.map((c) => inlineText(c.tokens)).join(" | ");
      out.push({ spans: styled(row(t.header)) });
      for (const r of t.rows ?? []) out.push({ spans: styled(row(r)) });
      break;
    }
    case "html":
      out.push({ spans: styled((token as Tokens.HTML).text ?? "") });
      break;
    default:
      out.push({ spans: styled(inlineText((token as { tokens?: InlineToken[] }).tokens) || (token as { text?: string }).text || (token as { raw?: string }).raw || "") });
      break;
  }
}

function itemBlockLines(
  item: Tokens.ListItem,
  bullet: string,
  indent: number,
  out: AnnotationSvgLine[],
  _ordered: number | undefined,
): void {
  let first = true;
  const nested: Tokens.GenericToken[] = [];
  for (const t of item.tokens ?? []) {
    if (t.type === "list") {
      nested.push(t as Tokens.GenericToken);
      continue;
    }
    const start = out.length;
    blockLines(t as Tokens.GenericToken, indent, out);
    for (let i = start; i < out.length; i++) {
      if (first && i === start) {
        out[i].spans = [prefixSpan(bullet), ...out[i].spans];
        first = false;
      } else if (i === start) {
        out[i].spans = [prefixSpan("  "), ...out[i].spans];
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
  if (!text) return [{ spans: [] }];
  let tokens: Tokens.GenericToken[];
  try {
    tokens = annotationMarked.lexer(text) as Tokens.GenericToken[];
  } catch {
    return text.split("\n").map((t) => ({ spans: t ? [{ text: t }] : [] }));
  }
  const out: AnnotationSvgLine[] = [];
  for (const t of tokens) blockLines(t, 0, out);
  return out.length > 0 ? out : [{ spans: [] }];
}

/** Plain rendered text of one line (Markdown syntax stripped) — for geometry. */
export function annotationSvgLineText(line: AnnotationSvgLine): string {
  return line.spans.map((s) => s.text).join("");
}
