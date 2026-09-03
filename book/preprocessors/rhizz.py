#!/usr/bin/env python3
"""mdbook preprocessor for ```rhizz code blocks, with book.lock golden checks.

Each fenced block tagged `rhizz` is written to a temp project, compiled with
the rhizz CLI (`--json build`), and replaced by the original HCL code block
plus an HTML panel summarizing the compiler's verdict:

- errors are listed in red, warnings in amber (matching the CLI convention);
- when the model compiles, the panel shows the completion score broken down
  by category (components / ports / connections / messages) plus the overall
  percentage, in the spirit of the frontend's `ModelStatsRow`.

Block attributes after the tag (e.g. ```rhizz,ignore) are supported: `ignore`
renders the code without compiling it.

Golden-file verification (`book/book.lock`)
-------------------------------------------

The preprocessor also acts as a guard against silently drifting documentation:
every compiled block is traced from its HCL input to its normalized compiler
output ({errors, warnings, score}) and compared against `book/book.lock`
inside the book directory:

- key = (chapter path, sha256 of the exact HCL input), value = normalized
  compiler output;
- on a normal build a mismatch (changed output, new block, removed block,
  missing or corrupt lock file) aborts the build with a per-entry diff;
- set `BOOKLOCK_ACCEPT_CHANGES=1` to regenerate `book/book.lock` in place
  (review the diff it prints before committing).

Normalization keeps the comparison deterministic:

- diagnostics are sorted by (code, line, message) so compiler reordering
  cannot cause spurious failures;
- the `file` field of a diagnostic is dropped (its value is a tempdir path
  that legitimately changes between runs);
- the lock is written as indented, key-sorted JSON.

Metadata (`format` number, `rhizz_version`) is stored for humans and is not
part of the comparison. A state where the compiler could not run (missing
binary, per-block tool failures) is never locked and always fails the build:
a lock must mean "the current toolchain produced exactly this output".

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
LOCK_FILE = REPO_ROOT / "book" / "book.lock"
LOCK_FORMAT = 1

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


def accept_changes_enabled() -> bool:
    """True when book.lock may be regenerated from current compiler output."""
    return os.environ.get("BOOKLOCK_ACCEPT_CHANGES", "").lower() not in ("", "0", "false", "no")


def die(message: str) -> None:
    sys.stderr.write(f"book.lock: {message}\n")
    sys.exit(1)


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


def rhizz_version(bin_path: str | None) -> str | None:
    """Best-effort `rhizz --version` output; None when unavailable."""
    if not bin_path:
        return None
    try:
        proc = subprocess.run([bin_path, "--version"], capture_output=True, text=True, timeout=30)
        return (proc.stdout or proc.stderr).strip() or None
    except Exception:  # noqa: BLE001 - metadata only, never fatal
        return None


# ---------------------------------------------------------------------------
# Normalization: turn raw `--json build` dicts into the deterministic form
# that book.lock compares.
# ---------------------------------------------------------------------------


def normalize_diag(d: dict) -> dict:
    """Keep code / line / message; drop `file` (a tempdir path that changes)."""
    out = {"code": str(d.get("code", ""))}
    line = d.get("line")
    if line is not None:
        out["line"] = int(line)
    out["message"] = str(d.get("message", ""))
    return out


def diag_sort_key(d: dict):
    return (d.get("code", ""), d.get("line", -1), d.get("message", ""))


def normalize_output(raw: dict) -> dict | None:
    """Return the comparable {errors, warnings, score} for a compile result.

    Returns None when the compile did not run (`tool_error`). Such a state is
    never written to book.lock and never accepted as a match — a lock must
    always describe what the current toolchain really produced.
    """
    if raw.get("tool_error"):
        return None
    out = {
        "errors": sorted((normalize_diag(e) for e in raw.get("errors") or []), key=diag_sort_key),
        "warnings": sorted((normalize_diag(w) for w in raw.get("warnings") or []), key=diag_sort_key),
    }
    if raw.get("score"):
        out["score"] = raw["score"]
    return out


# ---------------------------------------------------------------------------
# The lock file.
# ---------------------------------------------------------------------------


def lock_payload(entries: list[dict], compiler_version: str | None) -> dict:
    return {
        "format": LOCK_FORMAT,
        "rhizz_version": compiler_version or "unknown",
        "entries": sorted(entries, key=lambda e: (e["chapter"], e["input_sha256"])),
    }


def write_lock(entries: list[dict], compiler_version: str | None) -> None:
    text = json.dumps(lock_payload(entries, compiler_version), indent=2, ensure_ascii=False, sort_keys=True) + "\n"
    tmp = LOCK_FILE.with_name(LOCK_FILE.name + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, LOCK_FILE)


def read_lock() -> tuple[dict | None, str | None]:
    """Return (parsed lock, error). A missing file is (None, None)."""
    try:
        return json.loads(LOCK_FILE.read_text(encoding="utf-8")), None
    except FileNotFoundError:
        return None, None
    except Exception as exc:  # noqa: BLE001 - corrupt file is a hard failure
        return None, f"{LOCK_FILE} exists but cannot be parsed: {exc}"


def render_output(out) -> str:
    return json.dumps(out, sort_keys=True, ensure_ascii=False)


def compare_lock(lock: dict, blocks: dict, current_version: str | None) -> tuple[list[str], list[str]]:
    """Diff the current blocks against the lock.

    Returns (diffs, notes). Diffs abort the build (unless accepting);
    notes are informational (metadata drift, not output drift).
    """
    diffs: list[str] = []
    notes: list[str] = []

    if lock.get("format") != LOCK_FORMAT:
        diffs.append(
            f"{LOCK_FILE} uses lock format {lock.get('format')!r}, expected {LOCK_FORMAT} "
            f"(regenerate with BOOKLOCK_ACCEPT_CHANGES=1)"
        )
        return diffs, notes

    locked = {(e.get("chapter"), e.get("input_sha256")): e for e in lock.get("entries") or []}

    for (chapter, sha), block in sorted(blocks.items()):
        if (chapter, sha) not in locked:
            diffs.append(
                f"new block in {chapter!r} (input {sha[:8]}) is not present in book.lock"
            )
            continue
        old = locked[(chapter, sha)].get("output")
        new = block.get("output")
        if old != new:
            diffs.append(
                f"output changed for block in {chapter!r} (input {sha[:8]}):\n"
                f"    lock: {render_output(old)}\n"
                f"    now:  {render_output(new)}"
            )

    for (chapter, sha), entry in sorted(locked.items()):
        if (chapter, sha) not in blocks:
            diffs.append(
                f"block in {chapter!r} (input {sha[:8]}) was removed from the book "
                f"but is still present in book.lock"
            )

    locked_version = lock.get("rhizz_version")
    if locked_version and current_version and locked_version != current_version:
        notes.append(
            f"book.lock was generated with {locked_version!r}, the current compiler "
            f"reports {current_version!r} (outputs still match)"
        )
    return diffs, notes


# ---------------------------------------------------------------------------
# Rendering.
# ---------------------------------------------------------------------------


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


def body_hash(body: str) -> str:
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


def transform_chapter(chapter: dict, results: dict[str, dict]) -> tuple[str, dict]:
    """Replace every ```rhizz block with ```hcl + a verdict panel.

    Returns (new content, {(chapter, sha): block entry}) where each entry is
    {"chapter", "input_sha256", "hcl", "output"} — the tracing written to
    book.lock. Block output may be None when the tool failed; callers treat
    that as a degraded environment.
    """
    content = chapter.get("content") or ""
    chapter_path = chapter.get("path") or chapter.get("source_path") or chapter.get("name") or "<unknown>"
    segments = parse_blocks(content.splitlines())

    out: list[str] = []
    blocks: dict[tuple[str, str], dict] = {}
    for seg in segments:
        if seg[0] == "text":
            out.extend(seg[1])
            continue
        _, attrs, body_lines = seg
        body = "\n".join(body_lines)
        sha = body_hash(body)

        out.append("```hcl")
        out.extend(body_lines)
        out.append("```")
        out.append("")
        if "ignore" in attrs:
            out.append(IGNORE_PANEL)
            out.append("")
            continue

        raw = results.get(sha, {"tool_error": "no compile result recorded"})
        blocks[(chapter_path, sha)] = {
            "chapter": chapter_path,
            "input_sha256": sha,
            "hcl": body,
            "output": normalize_output(raw),
        }
        out.append(panel_html(raw))
        out.append("")

    return "\n".join(out), blocks


# ---------------------------------------------------------------------------
# mdbook traversal.
# ---------------------------------------------------------------------------


def iter_chapters(items) -> list[dict]:
    """Flatten mdbook's book items into the chapter dicts, depth-first."""
    chapters: list[dict] = []
    stack = list(items or [])
    while stack:
        item = stack.pop()
        if not isinstance(item, dict):
            continue
        chapter = item.get("Chapter")
        if isinstance(chapter, dict):
            chapters.append(chapter)
            stack.extend(chapter.get("sub_items") or [])
        else:
            stack.extend(item.get("sub_items") or [])
    return chapters


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

    _ctx, book = json.loads(raw)
    chapters = iter_chapters(book.get("items") or [])

    # Degraded environment: cannot compile -> cannot verify -> must not lock.
    if RHIZZ_BIN is None:
        die("rhizz binary not found (set $RHIZZ_BIN or add it to PATH); cannot compile blocks or verify book.lock")

    # Compile each distinct HCL body once.
    unique_bodies: dict[str, str] = {}
    for ch in chapters:
        for seg in parse_blocks((ch.get("content") or "").splitlines()):
            if seg[0] == "block" and "ignore" not in seg[1]:
                unique_bodies.setdefault(body_hash("\n".join(seg[2])), "\n".join(seg[2]))

    results: dict[str, dict] = {}
    if unique_bodies:
        with ThreadPoolExecutor(max_workers=MAX_COMPILE_WORKERS) as pool:
            for sha, data in zip(unique_bodies.keys(), pool.map(compile_one, unique_bodies.values())):
                results[sha] = data

    # Transform every chapter, collecting the input -> output trace.
    entries: dict[tuple[str, str], dict] = {}
    degraded: list[str] = []
    for ch in chapters:
        new_content, chapter_entries = transform_chapter(ch, results)
        ch["content"] = new_content
        for key, entry in chapter_entries.items():
            entries[key] = entry
            if entry["output"] is None:
                degraded.append(f"{entry['chapter']!r} (input {entry['input_sha256'][:8]})")

    if degraded:
        die(
            "cannot verify book.lock: the compiler failed for block(s) "
            + ", ".join(degraded)
            + "; fix the toolchain first"
        )

    # book.lock verification.
    current_version = rhizz_version(RHIZZ_BIN)
    lock, lock_error = read_lock()
    if lock_error:
        die(f"{lock_error}; delete it and regenerate with BOOKLOCK_ACCEPT_CHANGES=1")

    if lock is None:
        if accept_changes_enabled():
            write_lock(list(entries.values()), current_version)
            sys.stderr.write(f"book.lock: generated {len(entries)} entries\n")
        else:
            die(
                f"{LOCK_FILE} not found; generate it once with BOOKLOCK_ACCEPT_CHANGES=1"
            )
    else:
        diffs, notes = compare_lock(lock, entries, current_version)
        if diffs:
            rendered = "\n".join(f"  - {d}" for d in diffs)
            if accept_changes_enabled():
                write_lock(list(entries.values()), current_version)
                sys.stderr.write(f"book.lock regenerated ({len(entries)} entries):\n{rendered}\n")
            else:
                sys.stderr.write(f"book.lock is out of date ({len(diffs)} difference(s)):\n{rendered}\n")
                die("re-run with BOOKLOCK_ACCEPT_CHANGES=1 to regenerate book.lock")
        else:
            for note in notes:
                sys.stderr.write(f"book.lock: note: {note}\n")

    json.dump(book, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()