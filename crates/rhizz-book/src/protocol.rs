//! mdbook 0.5.x preprocessor protocol and the end-to-end build pipeline.
//!
//! mdbook invokes the binary twice: a `supports <renderer>` probe (exit 0
//! means the renderer is supported) and then the real run with a
//! `[context, book]` JSON document on stdin, expecting the transformed
//! `book` JSON back on stdout. mdbook sets the working directory to the book
//! root and `context.root` holds that root, which is where `book.lock` lives.

use crate::blocks::{Segment, body_hash, parse_blocks, split_lines};
use crate::compile::compile_body;
use crate::lock::{
    LOCK_FORMAT, LockPayload, accept_changes_enabled, compare_lock, format_diff, read_lock,
    sorted_entries, write_lock,
};
use crate::transform::{CompileResults, transform_chapter};
use anyhow::{Context, Result, bail};
use serde_json::Value;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;

/// Compiler version string stored in `book.lock` (mirrors `rhizz --version`).
#[must_use]
pub fn version_string() -> String {
    format!("rhizz {}", env!("CARGO_PKG_VERSION"))
}

/// True when `args` describe a `supports <renderer>` probe invocation.
#[must_use]
pub fn is_supports_probe(args: &[String]) -> bool {
    args.get(1).is_some_and(|arg| arg == "supports")
}

/// The renderer argument from a `supports` probe invocation.
#[must_use]
pub fn probe_renderer(args: &[String]) -> Option<&str> {
    args.get(2).map(String::as_str)
}

/// Read all of stdin.
///
/// # Errors
///
/// Returns an error when reading from the underlying stream fails.
pub fn read_stdin(reader: &mut impl Read) -> Result<String> {
    let mut buffer = String::new();
    reader
        .read_to_string(&mut buffer)
        .context("read preprocessor stdin")?;
    Ok(buffer)
}

/// Parse the `[context, book]` JSON sent by mdbook; missing halves become
/// `null` so callers can fall back gracefully.
///
/// # Errors
///
/// Returns an error when `raw` is not a JSON array of `[context, book]`.
pub fn parse_input(raw: &str) -> Result<(Value, Value)> {
    let values: Vec<Value> =
        serde_json::from_str(raw).context("mdbook sent invalid preprocessor input")?;
    let context = values.first().cloned().unwrap_or(Value::Null);
    let book = values.get(1).cloned().unwrap_or(Value::Null);
    Ok((context, book))
}

/// Chapter identity: `path`, else `source_path`, else `name`, else `<unknown>`.
#[must_use]
pub fn chapter_path(chapter: &Value) -> String {
    for key in ["path", "source_path", "name"] {
        if let Some(value) = chapter.get(key).and_then(Value::as_str) {
            return value.to_owned();
        }
    }
    "<unknown>".to_owned()
}

/// Visit every chapter in depth-first book order (read-only).
pub fn for_each_chapter(book: &Value, visit: &mut impl FnMut(&str, &str)) {
    let Some(items) = book.get("items").and_then(Value::as_array) else {
        return;
    };
    walk_read(items, visit);
}

fn walk_read(items: &[Value], visit: &mut impl FnMut(&str, &str)) {
    for item in items {
        if let Some(chapter) = item.get("Chapter") {
            let path = chapter_path(chapter);
            if let Some(content) = chapter.get("content").and_then(Value::as_str) {
                visit(&path, content);
            }
            if let Some(sub_items) = chapter.get("sub_items").and_then(Value::as_array) {
                walk_read(sub_items, visit);
            }
        } else if let Some(sub_items) = item.get("sub_items").and_then(Value::as_array) {
            walk_read(sub_items, visit);
        }
    }
}

/// Rewrite every chapter's `content` in depth-first book order.
pub fn map_chapters(book: &mut Value, rewrite: &mut impl FnMut(&str, &str) -> String) {
    let Some(items) = book.get_mut("items").and_then(Value::as_array_mut) else {
        return;
    };
    walk_mut(items, rewrite);
}

fn walk_mut(items: &mut [Value], rewrite: &mut impl FnMut(&str, &str) -> String) {
    for item in items {
        if let Some(chapter) = item.get_mut("Chapter") {
            let path = chapter_path(chapter);
            if let Some(content_slot) = chapter.get_mut("content")
                && let Some(new_content) =
                    content_slot.as_str().map(|content| rewrite(&path, content))
            {
                *content_slot = Value::String(new_content);
            }
            if let Some(sub_items) = chapter.get_mut("sub_items").and_then(Value::as_array_mut) {
                walk_mut(sub_items, rewrite);
            }
        } else if let Some(sub_items) = item.get_mut("sub_items").and_then(Value::as_array_mut) {
            walk_mut(sub_items, rewrite);
        }
    }
}

/// Compile each distinct body once and log one line per body, naming the
/// owning chapter when the body is used by exactly one chapter and the share
/// count otherwise.
#[must_use]
fn compile_distinct_bodies(
    bodies: &HashMap<String, String>,
    used_by: &HashMap<String, Vec<String>>,
) -> CompileResults {
    let mut results: CompileResults = HashMap::with_capacity(bodies.len());
    for (hash, body) in bodies {
        let verdict = compile_body(body);
        let chapters = used_by.get(hash).map_or(&[][..], Vec::as_slice);
        match chapters {
            [chapter] => tracing::info!(
                chapter = %chapter,
                bytes = body.len(),
                errors = verdict.errors.len(),
                warnings = verdict.warnings.len(),
                scored = verdict.score.is_some(),
                "compiled rhizz block"
            ),
            chapters => tracing::info!(
                chapters = chapters.len(),
                bytes = body.len(),
                errors = verdict.errors.len(),
                warnings = verdict.warnings.len(),
                scored = verdict.score.is_some(),
                "compiled rhizz block (shared body)"
            ),
        }
        results.insert(hash.clone(), verdict);
    }
    results
}

/// Run the full pipeline for one mdbook build.
///
/// Compiles every distinct block body once, transforms every chapter,
/// verifies (or, with `accept_changes`, regenerates) `book.lock`, and
/// returns the transformed book as JSON for stdout.
///
/// # Errors
///
/// Returns an error when any chapter cannot be transformed (should not
/// happen), when the lock file is missing or stale (unless
/// `accept_changes`), when the lock is corrupt, or when lock I/O fails.
/// Progress and diff output are written to `err`.
pub fn process_book(
    book: &mut Value,
    lock_path: &Path,
    version: &str,
    accept_changes: bool,
    color: bool,
    err: &mut dyn Write,
) -> Result<String> {
    // Collect the distinct block bodies, tracking which chapters reference
    // each one so the compile logs below can name their origin even though a
    // body is compiled once across the whole book (and may be shared).
    let mut bodies: HashMap<String, String> = HashMap::new();
    let mut used_by: HashMap<String, Vec<String>> = HashMap::new();
    for_each_chapter(book, &mut |chapter, content| {
        for segment in &parse_blocks(&split_lines(content)) {
            if let Segment::Block { attrs, body } = segment
                && !attrs.iter().any(|attr| attr == "ignore")
            {
                let body_new = body.join("\n");
                let hash = body_hash(&body_new);
                if !used_by.contains_key(&hash) {
                    bodies.insert(hash.clone(), body_new);
                }
                used_by.entry(hash).or_default().push(chapter.to_owned());
            }
        }
    });

    // Compile each distinct body once, attributing the log line to its
    // chapter when the body is unique, otherwise noting the share count.
    tracing::info!(
        distinct_blocks = bodies.len(),
        "compiling distinct rhizz blocks"
    );
    let results = compile_distinct_bodies(&bodies, &used_by);

    // Transform every chapter, collecting the input→output traces.
    let mut traces = Vec::new();
    map_chapters(book, &mut |path, content| {
        let (new_content, chapter_traces) = transform_chapter(path, content, &results);
        traces.extend(chapter_traces);
        new_content
    });

    // book.lock verification.
    let payload = LockPayload {
        entries: sorted_entries(traces),
        format: LOCK_FORMAT,
        rhizz_version: version.to_owned(),
    };
    match read_lock(lock_path)? {
        None => {
            if accept_changes {
                write_lock(lock_path, &payload)?;
                writeln!(
                    err,
                    "book.lock: generated {} entries",
                    payload.entries.len()
                )
                .context("write progress to stderr")?;
            } else {
                bail!(
                    "{} not found; generate it once with BOOKLOCK_ACCEPT_CHANGES=1",
                    lock_path.display()
                );
            }
        }
        Some(lock) => {
            let (diffs, notes) = compare_lock(&lock, &payload.entries, version);
            if diffs.is_empty() {
                for note in &notes {
                    writeln!(err, "book.lock: note: {note}").context("write progress to stderr")?;
                }
            } else {
                let rendered = diffs
                    .iter()
                    .map(|diff| format_diff(diff, color))
                    .collect::<Vec<_>>()
                    .join("\n");
                if accept_changes {
                    write_lock(lock_path, &payload)?;
                    writeln!(
                        err,
                        "book.lock regenerated ({} entries):\n{rendered}",
                        payload.entries.len()
                    )
                    .context("write progress to stderr")?;
                } else {
                    writeln!(
                        err,
                        "book.lock is out of date ({} difference(s)):\n{rendered}",
                        diffs.len()
                    )
                    .context("write progress to stderr")?;
                    bail!("re-run with BOOKLOCK_ACCEPT_CHANGES=1 to regenerate book.lock");
                }
            }
        }
    }

    serde_json::to_string(book).context("serialize transformed book")
}

/// `BOOKLOCK_ACCEPT_CHANGES` re-export kept next to use in `main`.
#[must_use]
pub fn is_accept_changes_enabled() -> bool {
    accept_changes_enabled()
}

#[cfg(test)]
mod tests {
    use super::{
        chapter_path, for_each_chapter, is_supports_probe, map_chapters, parse_input,
        probe_renderer, process_book, version_string,
    };
    use serde_json::{Value, json};
    use std::io::Cursor;
    use std::path::PathBuf;
    use tempfile::TempDir;

    /// A book with a chapter, a nested sub-chapter, a separator, and a draft
    /// chapter inside a part — exercising every traversal branch.
    fn sample_book() -> Value {
        json!({
            "items": [
                {"Chapter": {
                    "name": "Ch",
                    "content": "# T\n\n```rhizz\nproject {}\n```\n",
                    "path": "ch.md",
                    "number": [1],
                    "sub_items": [
                        {"Chapter": {
                            "name": "Sub",
                            "content": "sub text",
                            "source_path": "sub.md",
                            "number": [1, 1],
                            "sub_items": []
                        }}
                    ]
                }},
                "Separator",
                {"PartTitle": "Part 2", "sub_items": [
                    {"Chapter": {
                        "name": "Draft",
                        "content": "draft",
                        "name2": "ignored",
                        "number": [2]
                    }}
                ]}
            ]
        })
    }

    #[test]
    fn probe_detection() {
        assert!(is_supports_probe(&[
            "rhizz-book".to_owned(),
            "supports".to_owned(),
            "html".to_owned()
        ]));
        assert!(!is_supports_probe(&[
            "rhizz-book".to_owned(),
            "html".to_owned()
        ]));
        assert!(!is_supports_probe(&["rhizz-book".to_owned()]));
        assert_eq!(
            probe_renderer(&[
                "rhizz-book".to_owned(),
                "supports".to_owned(),
                "html".to_owned()
            ]),
            Some("html")
        );
        assert_eq!(probe_renderer(&["rhizz-book".to_owned()]), None);
    }

    #[test]
    fn parse_input_extracts_context_and_book() {
        let raw = r#"[{"root": "/tmp/book", "renderer": "html"}, {"items": []}]"#;
        let (context, book) = parse_input(raw).expect("valid input");
        assert_eq!(
            context.get("root").and_then(Value::as_str),
            Some("/tmp/book")
        );
        assert!(
            book.get("items")
                .and_then(Value::as_array)
                .is_some_and(Vec::is_empty)
        );
        assert!(parse_input("not json").is_err());
    }

    #[test]
    fn chapter_path_falls_back_path_source_name() {
        let chapter = json!({"path": "a.md", "source_path": "b.md", "name": "c"});
        assert_eq!(chapter_path(&chapter), "a.md");
        let no_path = json!({"source_path": "b.md", "name": "c"});
        assert_eq!(chapter_path(&no_path), "b.md");
        let name_only = json!({"name": "c"});
        assert_eq!(chapter_path(&name_only), "c");
        assert_eq!(chapter_path(&json!({})), "<unknown>");
    }

    #[test]
    fn for_each_chapter_visits_in_depth_first_order() {
        let mut visited = Vec::new();
        for_each_chapter(&sample_book(), &mut |path, _| visited.push(path.to_owned()));
        assert_eq!(visited, vec!["ch.md", "sub.md", "Draft"]);
    }

    #[test]
    fn map_chapters_rewrites_content_in_place() {
        let mut book = sample_book();
        map_chapters(&mut book, &mut |path, content| format!("[{path}]{content}"));
        let json = book.to_string();
        assert!(json.contains("[ch.md]# T"));
        assert!(json.contains("[sub.md]sub text"));
        assert!(json.contains("[Draft]draft"));
    }

    #[test]
    fn version_string_matches_lock_convention() {
        assert!(version_string().starts_with("rhizz "));
    }

    #[test]
    fn process_book_end_to_end_generates_then_verifies_lock() {
        let dir = TempDir::new().expect("tempdir");
        let lock_path = PathBuf::from(dir.path()).join("book.lock");
        let mut err = Cursor::new(Vec::new());

        let mut book = sample_book();
        let json_out = process_book(&mut book, &lock_path, "rhizz 0.1.0", true, false, &mut err)
            .expect("pipeline should succeed when accepting changes");
        assert!(json_out.contains("rhizz-diag"));
        assert!(json_out.contains("```hcl"));
        assert!(lock_path.exists(), "lock should be written on first run");

        // Second run without accepting: lock matches -> no diff, same output.
        let mut book = sample_book();
        let again = process_book(&mut book, &lock_path, "rhizz 0.1.0", false, false, &mut err)
            .expect("unchanged book should verify against the lock");
        assert_eq!(json_out, again);
        let err_bytes = err.into_inner();
        let err_text = String::from_utf8_lossy(&err_bytes);
        assert!(!err_text.contains("out of date"));
    }

    #[test]
    fn process_book_refuses_missing_lock_without_accept() {
        let dir = TempDir::new().expect("tempdir");
        let lock_path = PathBuf::from(dir.path()).join("book.lock");
        let mut err = Cursor::new(Vec::new());
        let mut book = sample_book();
        let result = process_book(&mut book, &lock_path, "rhizz 0.1.0", false, false, &mut err);
        let message = result
            .expect_err("missing lock must fail without accept")
            .to_string();
        assert!(message.contains("not found"), "unexpected error: {message}");
        assert!(message.contains("BOOKLOCK_ACCEPT_CHANGES=1"));
    }

    #[test]
    fn process_book_detects_out_of_date_lock() {
        let dir = TempDir::new().expect("tempdir");
        let lock_path = PathBuf::from(dir.path()).join("book.lock");
        let mut err = Cursor::new(Vec::new());
        let mut book = sample_book();
        process_book(&mut book, &lock_path, "rhizz 0.1.0", true, false, &mut err)
            .expect("seed lock");
        err = Cursor::new(Vec::new());

        // A second chapter whose block is not in the lock must fail without accept.
        let mut drifted = sample_book();
        if let Some(chapter) = drifted
            .get_mut("items")
            .and_then(Value::as_array_mut)
            .and_then(|items| items.first_mut())
            .and_then(|item| item.get_mut("Chapter"))
        {
            chapter["content"] =
                Value::String("# T\n\n```rhizz\nproject { name = \"other\" }\n```\n".to_owned());
        }
        let result = process_book(
            &mut drifted,
            &lock_path,
            "rhizz 0.1.0",
            false,
            false,
            &mut err,
        );
        let message = result
            .expect_err("stale lock must fail without accept")
            .to_string();
        assert!(
            message.contains("re-run with BOOKLOCK_ACCEPT_CHANGES=1"),
            "unexpected error: {message}"
        );
        let err_bytes = err.into_inner();
        let err_text = String::from_utf8_lossy(&err_bytes);
        assert!(err_text.contains("difference(s)"));
        assert!(err_text.contains("new block"));
    }
}
