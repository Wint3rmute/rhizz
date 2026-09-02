#!/usr/bin/env python3
"""mdbook preprocessor for ```rhizz code blocks.

Each fenced block tagged `rhizz` is written to a temp project, compiled with
the rhizz CLI (`--json build`), and replaced by the original HCL code block
plus an HTML panel summarizing the compiler's verdict:

- errors are listed in red, warnings in amber (matching the CLI convention);
- when the model compiles, the panel shows the completion score broken down
  by category (components / ports / connections / messages) plus the overall
  percentage, in the spirit of the frontend's `ModelStatsRow`.

Block attributes after the tag (e.g. ```rhizz,ignore) are supported: `ignore`
renders the code without compiling it.

Requires only the Python standard library. The rhizz binary is located via
$RHIZZ_BIN, then $PATH, then the repository's target/{release,debug} dirs.

mdbook protocol (0.5.x):
- probe: `preprocessor supports <renderer>` -> print "true"/"false".
- build:  JSON list of renderer contexts on stdin, same list back on stdout.
"""

import hashlib
import html
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent

# ```
_FENCE_OPEN_RE = re.compile(r"^[ \t]*```[ \t]*rhizz[ \t]*(.*)$")
_FENCE_CLOSE_RE = re.compile(r"^[ \t]*```+\s*$")

MAX_COMPILE_WORKERS = 8


def find_rhizz() -> str | None:
    """Locate the rhizz binary the way mdbook users would expect."""
    env = os.environ.get("RHIZZ_BIN")
    if env:
        return env
    found = shutil.which("rhizz")
    if found:
        return found
    for name in ("target/release/rhizz", "target/debug/rhizz"):
        candidate = REPO_ROOT / name
        if candidate.is_file():
            return str(candidate)
    return None


RHIZZ_BIN = find_rhizz()


def parse_block_attrs(raw: str) -> set[str]:
    """Turn the info-string suffix (e.g. ',ignore') into an attribute set."""
    return {a for a in re.split(r"[,\s]+", raw.strip()) if a}


def parse_blocks(lines: list[str]) -> list[tuple[str, object]]:
    """Split markdown lines into ('text', lines) and ('block', attrs, body) segments."""
    segments: list[tuple[str, object]] = []
    text: list[str] = []

    def flush():
        nonlocal text
        if text:
            segments.append(("text", text))
            text = []

    i = 0
    while i < len(lines):
        m = _FENCE_OPEN_RE.match(lines[i])
        if not m:
            text.append(lines[i])
            i += 1
            continue

        flush()
        attrs = parse_block_attrs(m.group(1))
        body: list[str] = []
        i += 1
        while i < len(lines) and not _FENCE_CLOSE_RE.match(lines[i]):
            body.append(lines[i])
            i += 1
        if i < len(lines):
            i += 1  # skip the closing fence
        segments.append(("block", attrs, body))

    flush()
    return segments


def compile_one(content: str) -> dict:
    """Compile `content` as system.hcl; return the `--json` output dict.

    Falls back to a {"tool_error": ...} dict on any failure so a broken
    environment degrades to an explanatory panel instead of failing the book.
    """
    if RHIZZ_BIN is None:
        return {"tool_error": "rhizz binary not found (set $RHIZZ_BIN or add it to PATH)"}

    tmp_dir = tempfile.mkdtemp(prefix="rhizz-book-")
    try:
        tmp = Path(tmp_dir)
        (tmp / "system.hcl").write_text(content, encoding="utf-8")
        proc = subprocess.run(
            [RHIZZ_BIN, "--json", "build", str(tmp), "--output-dir", str(tmp / "out")],
            capture_output=True,
            text=True,
            timeout=60,
        )
        return json.loads(proc.stdout)
    except json.JSONDecodeError:
        stderr = (proc.stderr or "").strip() if "proc" in locals() else ""
        return {
            "tool_error": f"rhizz returned non-JSON output (exit {proc.returncode}): {stderr[:300]}"
        }
    except Exception as exc:  # noqa: BLE001 - surface per-block failures in the panel
        return {"tool_error": f"{type(exc).__name__}: {exc}"}
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def esc(value) -> str:
    return html.escape(str(value), quote=True)


def plural(n: int, word: str) -> str:
    return f"{n} {word}" + ("" if n == 1 else "s")


def diagnostic_item(d: dict) -> str:
    loc = ""
    line = d.get("line")
    if line is not None:
        loc = f' <span class="rhizz-loc">(line {esc(line)})</span>'
    return (
        f'<li><span class="rhizz-code">{esc(d.get("code", ""))}</span>'
        f"\u2014 {esc(d.get('message', ''))}{loc}</li>"
    )


def stats_html(score: dict | None) -> str:
    if not score:
        return ""
    order = [
        ("components", "Components"),
        ("ports", "Ports"),
        ("connections", "Connections"),
        ("messages", "Messages"),
    ]
    items = "".join(
        f'<li class="rhizz-stat"><span>{label}</span>'
        f"<b>{score[cat]['complete']}/{score[cat]['total']}</b></li>"
        for cat, label in order
    )
    overall = score["overall"]["percent"]
    return f'<ul class="rhizz-stats">{items}<li class="rhizz-stat"><span>Overall</span><b>{esc(overall)}%</b></li></ul>'


def panel_html(data: dict) -> str:
    """Render the results panel for one compiled block."""
    if data.get("tool_error"):
        return (
            '<div class="rhizz-diag rhizz-tool"><div class="rhizz-head">'
            f"\u26a0 Compiler unavailable</div><p class=\"rhizz-msg\">{esc(data['tool_error'])}</p></div>"
        )

    errors = data.get("errors") or []
    warnings = data.get("warnings") or []
    score = data.get("score")

    if not errors and not warnings:
        return (
            '<div class="rhizz-diag rhizz-ok"><div class="rhizz-head">'
            f"\u2713 No errors, no warnings</div>{stats_html(score)}</div>"
        )

    if not errors:
        pct = score["overall"]["percent"] if score else None
        head = f"\u26a0 {plural(len(warnings), 'warning')} \u2014 "
        head += f"model completes at {pct}%" if pct is not None else "no completion score produced"
        items = "".join(diagnostic_item(w) for w in warnings)
        return (
            f'<div class="rhizz-diag rhizz-warn"><div class="rhizz-head">{head}</div>'
            f'<ul class="rhizz-diagnostics rhizz-warnings">{items}</ul>{stats_html(score)}</div>'
        )

    head = f"\u2717 {plural(len(errors), 'error')}, {plural(len(warnings), 'warning')} \u2014 no score (compilation failed)"
    error_items = "".join(diagnostic_item(e) for e in errors)
    warn_items = "".join(diagnostic_item(w) for w in warnings)
    return (
        f'<div class="rhizz-diag rhizz-error"><div class="rhizz-head">{head}</div>'
        f'<ul class="rhizz-diagnostics rhizz-errors">{error_items}</ul>'
        + (f'<ul class="rhizz-diagnostics rhizz-warnings">{warn_items}</ul>' if warn_items else "")
        + "</div>"
    )


IGNORE_PANEL = '<div class="rhizz-diag rhizz-ignore"><div class="rhizz-head">Not compiled in this book</div></div>'


def transform_content(content: str) -> str:
    """Replace every ```rhizz block with ```hcl + a compilation results panel."""
    segments = parse_blocks(content.splitlines())

    # Collect unique block bodies (compile each distinct model once).
    unique: dict[str, str] = {}
    for seg in segments:
        if seg[0] == "block":
            _, attrs, body = seg
            if "ignore" not in attrs:
                key = hashlib.sha256("\n".join(body).encode("utf-8")).hexdigest()
                unique[key] = "\n".join(body)

    results: dict[str, dict] = {}
    if unique:
        with ThreadPoolExecutor(max_workers=MAX_COMPILE_WORKERS) as pool:
            for key, data in zip(unique.keys(), pool.map(compile_one, unique.values())):
                results[key] = data

    out: list[str] = []
    for seg in segments:
        if seg[0] == "text":
            out.extend(seg[1])
            continue
        _, attrs, body = seg
        out.append("```hcl")
        out.extend(body)
        out.append("```")
        out.append("")
        if "ignore" in attrs:
            out.append(IGNORE_PANEL)
        else:
            key = hashlib.sha256("\n".join(body).encode("utf-8")).hexdigest()
            try:
                out.append(panel_html(results[key]))
            except Exception as exc:  # noqa: BLE001 - never break the book over one panel
                out.append(
                    f'<div class="rhizz-diag rhizz-tool"><div class="rhizz-head">'
                    f"\u26a0 Panel error</div><p class=\"rhizz-msg\">{esc(exc)}</p></div>"
                )
        out.append("")
    return "\n".join(out)


def process_item(item: dict) -> None:
    kind = item.get("Chapter")
    if kind:
        process_chapter(kind)


def process_chapter(chapter: dict) -> None:
    content = chapter.get("content")
    if isinstance(content, str):
        chapter["content"] = transform_content(content)
    for sub in chapter.get("sub_items") or []:
        if isinstance(sub, dict):
            process_item(sub)


def process_section(section: dict) -> None:
    chapter = section.get("Chapter")
    if not chapter:
        return
    content = chapter.get("content")
    if isinstance(content, str):
        chapter["content"] = transform_content(content)
    for sub in chapter.get("sub_items") or []:
        if isinstance(sub, dict):
            process_section(sub)


def main() -> None:
    renderer = sys.argv[1] if len(sys.argv) > 1 else "html"

    # mdbook 0.5.x probe: `cmd supports <renderer>` with stdin null, exit
    # code 0 means the preprocessor supports that renderer (stdout ignored).
    if renderer == "supports":
        _target = sys.argv[2] if len(sys.argv) > 2 else ""
        sys.exit(0 if _target in ("html",) else 1)

    # Build input: [PreprocessorContext, Book] where Book = {"items": [...]}.
    raw = sys.stdin.read().strip()
    if not raw:
        json.dump({"items": []}, sys.stdout)
        return

    ctx, book = json.loads(raw)
    for item in book.get("items") or []:
        if isinstance(item, dict):
            process_item(item)

    # mdbook expects a Book object (same shape) back, not the tuple.
    json.dump(book, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()