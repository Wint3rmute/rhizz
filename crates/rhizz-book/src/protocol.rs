//! mdbook 0.5.x preprocessor protocol and the end-to-end build pipeline.
//!
//! mdbook invokes the binary twice: a `supports <renderer>` probe (exit 0
//! means the renderer is supported) and then the real run with a
//! `[context, book]` JSON document on stdin, expecting the transformed
//! `book` JSON back on stdout. mdbook sets the working directory to the book
//! root and `context.root` holds that root, which is where `book.lock` lives.

use crate::blocks::{Segment, body_hash, parse_blocks, split_lines};
use crate::compile::{Verdict, compile_body};
use crate::lock::{
    LOCK_FORMAT, LockPayload, ProjectFileEntry, ProjectLockEntry, accept_changes_enabled,
    compare_lock, format_diff, read_lock, sorted_entries, sorted_projects, write_lock,
};
use crate::project::{
    LoadedProject, ProjectAttrs, ProjectPayloads, compile_project, encode_payload, load_project,
    parse_project_attrs,
};
use crate::transform::{CompileResults, transform_chapter};
use anyhow::{Context, Result, bail};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
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
                errors = verdict.errors.len(),
                warnings = verdict.warnings.len(),
                scored = verdict.score.is_some(),
                "compiled rhizz block"
            ),
            chapters => tracing::info!(
                chapters = chapters.len(),
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

/// One loaded, compiled and encoded book project, ready to render and trace.
struct BuiltProject {
    project: LoadedProject,
    verdict: Verdict,
    payload: String,
}

/// Load, compile and encode every distinct project referenced by `refs`.
///
/// Returns the built projects keyed by fence `src` plus the lock traces (one
/// per distinct chapter + `src` pair).
///
/// # Errors
///
/// Returns an error when a fence is malformed or its directory cannot be
/// loaded, compiled or encoded.
fn build_book_projects(
    refs: &[(String, ProjectAttrs)],
    src_root: &Path,
) -> Result<(HashMap<String, BuiltProject>, Vec<ProjectLockEntry>)> {
    let mut built: HashMap<String, BuiltProject> = HashMap::new();
    for (chapter, attrs) in refs {
        if built.contains_key(&attrs.src) {
            continue;
        }
        let project = load_project(src_root, &attrs.src).with_context(|| {
            format!(
                "cannot load book project '{}' referenced in '{chapter}'",
                attrs.src
            )
        })?;
        let verdict = compile_project(&project.files);
        tracing::info!(
            chapter = %chapter,
            src = %attrs.src,
            files = project.files.len(),
            errors = verdict.errors.len(),
            warnings = verdict.warnings.len(),
            "loaded book project"
        );
        let payload = encode_payload(&project.files).with_context(|| {
            format!(
                "cannot encode book project '{}' referenced in '{chapter}'",
                attrs.src
            )
        })?;
        built.insert(
            attrs.src.clone(),
            BuiltProject {
                project,
                verdict,
                payload,
            },
        );
    }
    let mut traces: Vec<ProjectLockEntry> = Vec::new();
    let mut seen: HashSet<(String, String)> = HashSet::new();
    for (chapter, attrs) in refs {
        if !seen.insert((chapter.clone(), attrs.src.clone())) {
            continue;
        }
        let Some(entry) = built.get(&attrs.src) else {
            bail!(
                "internal error: project '{}' was loaded but is missing",
                attrs.src
            );
        };
        if let Some(open) = &attrs.open
            && !entry.project.files.iter().any(|file| file.path == *open)
        {
            let known: Vec<&str> = entry
                .project
                .files
                .iter()
                .map(|file| file.path.as_str())
                .collect();
            bail!(
                "rhizz-project open={open:?} in '{chapter}' matches no file in '{}' (expected one of: {})",
                attrs.src,
                known.join(", ")
            );
        }
        traces.push(ProjectLockEntry {
            chapter: chapter.clone(),
            files: entry
                .project
                .files
                .iter()
                .map(|file| ProjectFileEntry {
                    path: file.path.clone(),
                    sha256: file.sha256.clone(),
                })
                .collect(),
            input_sha256: entry.project.input_sha256.clone(),
            output: entry.verdict.sorted.clone(),
            src: attrs.src.clone(),
        });
    }
    Ok((built, traces))
}

/// Collect the distinct `` ```rhizz `` block bodies, tracking which chapters
/// reference each one so compile logs can name their origin even though a
/// body is compiled once across the whole book (and may be shared).
fn collect_block_bodies(book: &Value) -> (HashMap<String, String>, HashMap<String, Vec<String>>) {
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
    (bodies, used_by)
}

/// Collect every `rhizz-project` fence in chapter order and parse its
/// attributes.
///
/// # Errors
///
/// Returns an error when any fence carries malformed attributes.
fn collect_project_refs(book: &Value) -> Result<Vec<(String, ProjectAttrs)>> {
    let mut raw_refs: Vec<(String, String)> = Vec::new();
    for_each_chapter(book, &mut |chapter, content| {
        for segment in &parse_blocks(&split_lines(content)) {
            if let Segment::ProjectBlock { attrs, .. } = segment {
                raw_refs.push((chapter.to_owned(), attrs.clone()));
            }
        }
    });
    let mut refs: Vec<(String, ProjectAttrs)> = Vec::with_capacity(raw_refs.len());
    for (chapter, raw) in &raw_refs {
        let attrs = parse_project_attrs(raw)
            .with_context(|| format!("invalid rhizz-project fence in '{chapter}'"))?;
        refs.push((chapter.clone(), attrs));
    }
    Ok(refs)
}

/// Run the full pipeline for one mdbook build.
///
/// Compiles every distinct block body once, loads and compiles every
/// referenced book project once, transforms every chapter, verifies (or,
/// with `accept_changes`, regenerates) `book.lock`, and returns the
/// transformed book as JSON for stdout.
///
/// `lock_path` points at `book.lock`; the book root is its parent directory
/// (project `src` attributes resolve under `<root>/src/`). `example_base_url`
/// is the deployed `/book-example` host used for iframe URLs.
///
/// # Errors
///
/// Returns an error when any chapter cannot be transformed (should not
/// happen), when a project fence is malformed or its directory cannot be
/// loaded, when the lock file is missing or stale (unless
/// `accept_changes`), when the lock is corrupt, or when lock I/O fails.
/// Progress and diff output are written to `err`.
pub fn process_book(
    book: &mut Value,
    lock_path: &Path,
    version: &str,
    accept_changes: bool,
    color: bool,
    err: &mut dyn Write,
    example_base_url: &str,
) -> Result<String> {
    let (bodies, used_by) = collect_block_bodies(book);

    // Compile each distinct body once, attributing the log line to its
    // chapter when the body is unique, otherwise noting the share count.
    tracing::info!(
        distinct_blocks = bodies.len(),
        "compiling distinct rhizz blocks"
    );
    let results = compile_distinct_bodies(&bodies, &used_by);

    // Load every referenced book project once (project `src` attributes
    // resolve under `<book root>/src/`). Any failure aborts the build: a
    // broken fence must never render a silently broken embed.
    let refs = collect_project_refs(book)?;
    let book_root = lock_path.parent().unwrap_or_else(|| Path::new("."));
    let src_root = book_root.join("src");
    let (built, project_traces) = build_book_projects(&refs, &src_root)?;
    let payloads: ProjectPayloads = built
        .iter()
        .map(|(src, built)| (src.clone(), built.payload.clone()))
        .collect();

    // Transform every chapter, collecting the input→output traces.
    let mut traces = Vec::new();
    map_chapters(book, &mut |path, content| {
        let (new_content, chapter_traces) =
            transform_chapter(path, content, &results, &payloads, example_base_url);
        traces.extend(chapter_traces);
        new_content
    });

    // book.lock verification.
    let payload = LockPayload {
        entries: sorted_entries(traces),
        format: LOCK_FORMAT,
        projects: sorted_projects(project_traces),
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
            let (diffs, notes) = compare_lock(&lock, &payload.entries, &payload.projects, version);
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
        let json_out = process_book(
            &mut book,
            &lock_path,
            "rhizz 0.1.0",
            true,
            false,
            &mut err,
            "https://example.invalid",
        )
        .expect("pipeline should succeed when accepting changes");
        assert!(json_out.contains("rhizz-diag"));
        assert!(json_out.contains("```hcl"));
        assert!(lock_path.exists(), "lock should be written on first run");

        // Second run without accepting: lock matches -> no diff, same output.
        let mut book = sample_book();
        let again = process_book(
            &mut book,
            &lock_path,
            "rhizz 0.1.0",
            false,
            false,
            &mut err,
            "https://example.invalid",
        )
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
        let result = process_book(
            &mut book,
            &lock_path,
            "rhizz 0.1.0",
            false,
            false,
            &mut err,
            "https://example.invalid",
        );
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
        process_book(
            &mut book,
            &lock_path,
            "rhizz 0.1.0",
            true,
            false,
            &mut err,
            "https://example.invalid",
        )
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
            "https://example.invalid",
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

    /// A book with one chapter carrying a project fence; the project lives in
    /// `<root>/src/projects/demo/`.
    fn project_book(content: &str) -> Value {
        json!({
            "items": [
                {"Chapter": {
                    "name": "Demo",
                    "content": content,
                    "path": "demo.md",
                    "source_path": "demo.md",
                    "number": [1],
                    "sub_items": []
                }}
            ]
        })
    }

    fn write_demo_project(root: &std::path::Path) {
        let proj = root.join("src/projects/demo");
        std::fs::create_dir_all(proj.join("diagrams")).expect("mkdir diagrams");
        std::fs::write(
            proj.join("system.hcl"),
            "system \"demo\" {\n  description = \"d\"\n}\n",
        )
        .expect("write system.hcl");
        std::fs::write(
            proj.join("diagrams/main.hcl"),
            "view \"main\" {\n  system = \"demo\"\n}\n",
        )
        .expect("write main.hcl");
    }

    #[test]
    fn process_book_embeds_project_and_traces_it_in_lock() {
        let dir = TempDir::new().expect("tempdir");
        write_demo_project(dir.path());
        let lock_path = PathBuf::from(dir.path()).join("book.lock");
        let mut err = Cursor::new(Vec::new());

        let mut book =
            project_book("# Demo\n\n```rhizz-project src=\"projects/demo\"\nCaption\n```\n");
        let json_out = process_book(
            &mut book,
            &lock_path,
            "rhizz 0.1.0",
            true,
            false,
            &mut err,
            "https://example.invalid",
        )
        .expect("project pipeline should succeed when accepting");
        assert!(json_out.contains("rhizz-project"));
        assert!(json_out.contains("https://example.invalid/book-example#p="));
        assert!(json_out.contains("rhizz-project-caption"));
        assert!(json_out.contains("Caption"));
        assert!(lock_path.exists(), "lock should be written on first run");

        // The lock carries one project trace with two files.
        let text = std::fs::read_to_string(&lock_path).expect("read lock");
        let payload: crate::lock::LockPayload = serde_json::from_str(&text).expect("lock parses");
        assert_eq!(payload.projects.len(), 1);
        assert_eq!(payload.projects[0].chapter, "demo.md");
        assert_eq!(payload.projects[0].src, "projects/demo");
        assert_eq!(payload.projects[0].files.len(), 2);

        // Second run verifies clean.
        let mut book =
            project_book("# Demo\n\n```rhizz-project src=\"projects/demo\"\nCaption\n```\n");
        let mut err = Cursor::new(Vec::new());
        let again = process_book(
            &mut book,
            &lock_path,
            "rhizz 0.1.0",
            false,
            false,
            &mut err,
            "https://example.invalid",
        )
        .expect("unchanged project should verify");
        assert_eq!(json_out, again);
    }

    #[test]
    fn process_book_fails_loudly_on_missing_project() {
        let dir = TempDir::new().expect("tempdir");
        let lock_path = PathBuf::from(dir.path()).join("book.lock");
        let mut err = Cursor::new(Vec::new());
        let mut book = project_book("# Demo\n\n```rhizz-project src=\"projects/nope\"\n```\n");
        let message = process_book(
            &mut book,
            &lock_path,
            "rhizz 0.1.0",
            true,
            false,
            &mut err,
            "https://example.invalid",
        )
        .expect_err("missing project must fail")
        .to_string();
        assert!(
            message.contains("projects/nope"),
            "unexpected error: {message}"
        );
    }

    #[test]
    fn process_book_rejects_open_pointing_outside_the_project() {
        let dir = TempDir::new().expect("tempdir");
        write_demo_project(dir.path());
        let lock_path = PathBuf::from(dir.path()).join("book.lock");
        let mut err = Cursor::new(Vec::new());
        let mut book = project_book(
            "# Demo\n\n```rhizz-project src=\"projects/demo\" open=\"nope.hcl\"\n```\n",
        );
        let message = process_book(
            &mut book,
            &lock_path,
            "rhizz 0.1.0",
            true,
            false,
            &mut err,
            "https://example.invalid",
        )
        .expect_err("unknown open target must fail")
        .to_string();
        assert!(
            message.contains("matches no file"),
            "unexpected error: {message}"
        );
    }

    #[test]
    fn process_book_embeds_open_target_in_iframe_url() {
        let dir = TempDir::new().expect("tempdir");
        write_demo_project(dir.path());
        let lock_path = PathBuf::from(dir.path()).join("book.lock");
        let mut err = Cursor::new(Vec::new());
        let mut book = project_book(
            "# Demo\n\n```rhizz-project src=\"projects/demo\" open=\"diagrams/main.hcl\"\n```\n",
        );
        let json_out = process_book(
            &mut book,
            &lock_path,
            "rhizz 0.1.0",
            true,
            false,
            &mut err,
            "https://example.invalid",
        )
        .expect("open target should embed");
        assert!(
            json_out.contains("book-example?open=diagrams%2Fmain.hcl#p="),
            "iframe URL should carry the open target"
        );
    }

    #[test]
    fn process_book_detects_changed_project_sources() {
        let dir = TempDir::new().expect("tempdir");
        write_demo_project(dir.path());
        let lock_path = PathBuf::from(dir.path()).join("book.lock");
        let mut err = Cursor::new(Vec::new());
        let mut book = project_book("# Demo\n\n```rhizz-project src=\"projects/demo\"\n```\n");
        process_book(
            &mut book,
            &lock_path,
            "rhizz 0.1.0",
            true,
            false,
            &mut err,
            "https://example.invalid",
        )
        .expect("seed lock");

        // Changing a project source must fail verification without accept.
        std::fs::write(
            dir.path().join("src/projects/demo/system.hcl"),
            "system \"changed\" {\n  description = \"d\"\n}\n",
        )
        .expect("rewrite system.hcl");
        let mut book = project_book("# Demo\n\n```rhizz-project src=\"projects/demo\"\n```\n");
        let mut err = Cursor::new(Vec::new());
        let message = process_book(
            &mut book,
            &lock_path,
            "rhizz 0.1.0",
            false,
            false,
            &mut err,
            "https://example.invalid",
        )
        .expect_err("changed project must fail")
        .to_string();
        assert!(
            message.contains("re-run with BOOKLOCK_ACCEPT_CHANGES=1"),
            "unexpected error: {message}"
        );
        let err_bytes = err.into_inner();
        let err_text = String::from_utf8_lossy(&err_bytes);
        assert!(
            err_text.contains("new project 'projects/demo'"),
            "{err_text}"
        );
    }
}
