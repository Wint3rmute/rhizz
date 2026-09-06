//! `book.lock` golden-file verification.
//!
//! Every compiled `` ```rhizz `` block is traced from its HCL input to its
//! normalized compiler output and compared against `book/book.lock`. A
//! mismatch (changed output, new block, removed block, missing/corrupt lock)
//! aborts the build unless `BOOKLOCK_ACCEPT_CHANGES` is set to a truthy
//! value, in which case the lock is regenerated in place.

use crate::normalize::NormalizedOutput;
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

/// Current lock format version.
pub const LOCK_FORMAT: u64 = 1;

/// The lock file name, relative to the book root.
pub const LOCK_FILENAME: &str = "book.lock";

/// One traced `` ```rhizz `` block. Field order mirrors the historical Python
/// writer's `sort_keys` output for stable, readable lock diffs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LockEntry {
    /// Chapter path the block lives in (`path`, else `source_path`, else `name`).
    pub chapter: String,
    /// Exact HCL body (used by the HTML panels and stored for humans).
    pub hcl: String,
    /// SHA-256 hex digest of the exact HCL body — the input key.
    pub input_sha256: String,
    /// Normalized compiler verdict.
    pub output: NormalizedOutput,
}

/// One traced `` ```rhizz-project `` embed. Field order is alphabetical for
/// stable, readable lock diffs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectLockEntry {
    /// Chapter path the fence lives in (`path`, else `source_path`, else `name`).
    pub chapter: String,
    /// Locked files (path + content hash each; contents live in `book/src/`).
    pub files: Vec<ProjectFileEntry>,
    /// SHA-256 hex digest over the whole file set — the input key.
    pub input_sha256: String,
    /// Normalized compiler verdict for the project sources.
    pub output: NormalizedOutput,
    /// Project directory as written in the fence (relative to `book/src/`).
    pub src: String,
}

/// One locked file of a book project.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectFileEntry {
    /// POSIX-style path relative to the project dir.
    pub path: String,
    /// SHA-256 hex digest of the file content.
    pub sha256: String,
}

/// The whole lock payload.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LockPayload {
    /// Per-block traces, sorted by (chapter, input hash).
    pub entries: Vec<LockEntry>,
    /// Lock format version; bumped when the entry schema changes.
    pub format: u64,
    /// Per-project traces, sorted by (chapter, src). Absent (defaulting to
    /// empty) in locks written before project embeds existed.
    #[serde(default)]
    pub projects: Vec<ProjectLockEntry>,
    /// Compiler version that produced the entries (metadata only).
    pub rhizz_version: String,
}

/// Resolve the lock path for a book root directory.
#[must_use]
pub fn lock_path(root: &Path) -> PathBuf {
    root.join(LOCK_FILENAME)
}

/// True when `BOOKLOCK_ACCEPT_CHANGES` is set to a truthy value.
#[must_use]
pub fn accept_changes_enabled() -> bool {
    accept_flag(std::env::var("BOOKLOCK_ACCEPT_CHANGES").ok().as_deref())
}

/// Parse the accept flag the way the Python preprocessor did: any value
/// other than empty, `0`, `false` or `no` (case-insensitive) enables it.
#[must_use]
pub fn accept_flag(raw: Option<&str>) -> bool {
    let Some(value) = raw else {
        return false;
    };
    !matches!(
        value.to_ascii_lowercase().as_str(),
        "" | "0" | "false" | "no"
    )
}

/// Read and parse the lock file. `Ok(None)` means the file does not exist; a
/// corrupt file is a hard error (a lock must mean "the current toolchain
/// produced exactly this output").
///
/// # Errors
///
/// Returns an error with context when the file exists but cannot be read or
/// parsed, or when the surrounding filesystem operation fails.
pub fn read_lock(path: &Path) -> Result<Option<LockPayload>> {
    let text = match fs::read_to_string(path) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(error).with_context(|| format!("cannot read {}", path.display()));
        }
    };
    serde_json::from_str(&text)
        .map(Some)
        .with_context(|| {
            format!(
                "{} exists but cannot be parsed; delete it and regenerate with BOOKLOCK_ACCEPT_CHANGES=1",
                path.display()
            )
        })
}

/// Write the lock atomically (temp file + rename, like the Python version).
///
/// # Errors
///
/// Returns an error when serializing the payload or performing the filesystem
/// write/rename fails.
pub fn write_lock(path: &Path, payload: &LockPayload) -> Result<()> {
    let mut text = serde_json::to_string_pretty(payload).context("serialize book.lock payload")?;
    text.push('\n');
    let tmp = PathBuf::from(format!("{}.tmp", path.display()));
    fs::write(&tmp, text).with_context(|| format!("write {}", tmp.display()))?;
    fs::rename(&tmp, path).with_context(|| format!("rename {} into place", path.display()))?;
    Ok(())
}

/// Short display form of a body hash (first 8 hex chars).
#[must_use]
pub fn short_sha(hash: &str) -> String {
    hash.chars().take(8).collect()
}

/// Compact single-line JSON of a normalized output, for diff messages.
/// One difference between the lock file and the current build state.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Diff {
    /// A compiled block exists now that the lock does not know.
    NewBlock {
        /// Chapter path the block lives in.
        chapter: String,
        /// SHA-256 digest of the block body.
        hash: String,
    },
    /// A locked block no longer exists in the book.
    RemovedBlock {
        /// Chapter path the block lived in.
        chapter: String,
        /// SHA-256 digest of the block body.
        hash: String,
    },
    /// The same block compiled to a different verdict than the lock stores.
    OutputChanged {
        /// Chapter path the block lives in.
        chapter: String,
        /// SHA-256 digest of the block body.
        hash: String,
        /// Verdict recorded in the lock.
        old: Box<NormalizedOutput>,
        /// Verdict the compiler produced now.
        new: Box<NormalizedOutput>,
    },
    /// A project embed exists now that the lock does not know.
    NewProject {
        /// Chapter path the fence lives in.
        chapter: String,
        /// Project directory as written in the fence.
        src: String,
    },
    /// A locked project embed no longer exists in the book.
    RemovedProject {
        /// Chapter path the fence lived in.
        chapter: String,
        /// Project directory as written in the fence.
        src: String,
    },
    /// The same project compiled to a different verdict than the lock stores.
    ProjectOutputChanged {
        /// Chapter path the fence lives in.
        chapter: String,
        /// Project directory as written in the fence.
        src: String,
        /// Verdict recorded in the lock.
        old: Box<NormalizedOutput>,
        /// Verdict the compiler produced now.
        new: Box<NormalizedOutput>,
    },
    /// The lock file predates the current schema.
    FormatMismatch {
        /// Format version found in the lock.
        found: u64,
    },
}

/// Pretty-print a normalized output the same way `book.lock` serializes it,
/// so the diff below compares like with like.
#[must_use]
fn render_pretty(output: &NormalizedOutput) -> String {
    serde_json::to_string_pretty(output).unwrap_or_else(|_| "<unserializable>".to_owned())
}

/// Build a git-style unified diff between two verdicts (`--- book.lock` vs
/// `+++ current compiler`), with three context lines so changes are easy to
/// locate inside the JSON.
#[must_use]
fn verdict_diff(old: &NormalizedOutput, new: &NormalizedOutput) -> String {
    similar::TextDiff::from_lines(render_pretty(old), render_pretty(new))
        .unified_diff()
        .context_radius(3)
        .header("book.lock", "current compiler")
        .to_string()
}

/// Apply ANSI color to a unified diff using git's scheme.
///
/// Header lines bold yellow, `@@` hunks cyan, `-` removals red, `+`
/// additions green; context lines stay plain. Detection trims leading
/// whitespace so nested lines inside `format_diff`'s indentation match.
#[must_use]
pub fn colorize_unified_diff(diff: &str) -> String {
    diff.lines()
        .map(|line| {
            let trimmed = line.trim_start();
            if trimmed.starts_with("---") || trimmed.starts_with("+++") {
                format!("\x1b[33;1m{line}\x1b[0m")
            } else if trimmed.starts_with("@@") {
                format!("\x1b[36m{line}\x1b[0m")
            } else if trimmed.starts_with('-') {
                format!("\x1b[31m{line}\x1b[0m")
            } else if trimmed.starts_with('+') {
                format!("\x1b[32m{line}\x1b[0m")
            } else {
                line.to_owned()
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Render a difference as an indented, multi-line report for stderr.
///
/// Output-changed diffs carry the pretty-printed, git-style unified diff of
/// the two verdicts, ANSI-colored when `color` is true. The other cases
/// are one-liners.
#[must_use]
pub fn format_diff(diff: &Diff, color: bool) -> String {
    match diff {
        Diff::NewBlock { chapter, hash } => format!(
            "  - new block in '{chapter}' (input {}) is not present in book.lock",
            short_sha(hash)
        ),
        Diff::RemovedBlock { chapter, hash } => format!(
            "  - block in '{chapter}' (input {}) was removed from the book but is still present in book.lock",
            short_sha(hash)
        ),
        Diff::FormatMismatch { found } => format!(
            "  - book.lock uses lock format {found}, expected {LOCK_FORMAT} (regenerate with BOOKLOCK_ACCEPT_CHANGES=1)"
        ),
        Diff::NewProject { chapter, src } => {
            format!("  - new project '{src}' in '{chapter}' is not present in book.lock")
        }
        Diff::RemovedProject { chapter, src } => format!(
            "  - project '{src}' in '{chapter}' was removed from the book but is still present in book.lock"
        ),
        Diff::ProjectOutputChanged {
            chapter,
            src,
            old,
            new,
        } => {
            let header = format!("  - output changed for project '{src}' in '{chapter}':");
            let body = verdict_diff(old, new)
                .lines()
                .map(|line| format!("    {line}"))
                .collect::<Vec<_>>()
                .join("\n");
            let body = if color {
                colorize_unified_diff(&body)
            } else {
                body
            };
            format!("{header}\n{body}")
        }
        Diff::OutputChanged {
            chapter,
            hash,
            old,
            new,
        } => {
            let header = format!(
                "  - output changed for block in '{chapter}' (input {}):",
                short_sha(hash)
            );
            let body = verdict_diff(old, new)
                .lines()
                .map(|line| format!("    {line}"))
                .collect::<Vec<_>>()
                .join("\n");
            let body = if color {
                colorize_unified_diff(&body)
            } else {
                body
            };
            format!("{header}\n{body}")
        }
    }
}

/// Compare the current block and project traces against the existing lock.
///
/// Returns (diffs, notes): diffs abort the build (unless accepting changes);
/// notes are informational metadata drift (version changed, outputs match).
#[must_use]
pub fn compare_lock(
    lock: &LockPayload,
    blocks: &[LockEntry],
    projects: &[ProjectLockEntry],
    current_version: &str,
) -> (Vec<Diff>, Vec<String>) {
    let mut diffs = Vec::new();
    let mut notes = Vec::new();

    if lock.format != LOCK_FORMAT {
        diffs.push(Diff::FormatMismatch { found: lock.format });
        return (diffs, notes);
    }

    let locked: HashSet<(&str, &str)> = lock.entries.iter().map(entry_key).collect();

    for block in blocks {
        if !locked.contains(&entry_key(block)) {
            diffs.push(Diff::NewBlock {
                chapter: block.chapter.clone(),
                hash: block.input_sha256.clone(),
            });
            continue;
        }
        if let Some(previous) = lock
            .entries
            .iter()
            .find(|entry| entry_key(entry) == entry_key(block))
            && previous.output != block.output
        {
            diffs.push(Diff::OutputChanged {
                chapter: block.chapter.clone(),
                hash: block.input_sha256.clone(),
                old: Box::new(previous.output.clone()),
                new: Box::new(block.output.clone()),
            });
        }
    }

    let current: HashSet<(&str, &str)> = blocks.iter().map(entry_key).collect();
    for entry in &lock.entries {
        if !current.contains(&entry_key(entry)) {
            diffs.push(Diff::RemovedBlock {
                chapter: entry.chapter.clone(),
                hash: entry.input_sha256.clone(),
            });
        }
    }

    let locked_projects: HashSet<(&str, &str, &str)> =
        lock.projects.iter().map(project_key).collect();
    for project in projects {
        if !locked_projects.contains(&project_key(project)) {
            diffs.push(Diff::NewProject {
                chapter: project.chapter.clone(),
                src: project.src.clone(),
            });
            continue;
        }
        if let Some(previous) = lock
            .projects
            .iter()
            .find(|entry| project_key(entry) == project_key(project))
            && previous.output != project.output
        {
            diffs.push(Diff::ProjectOutputChanged {
                chapter: project.chapter.clone(),
                src: project.src.clone(),
                old: Box::new(previous.output.clone()),
                new: Box::new(project.output.clone()),
            });
        }
    }

    let current_projects: HashSet<(&str, &str, &str)> = projects.iter().map(project_key).collect();
    for entry in &lock.projects {
        if !current_projects.contains(&project_key(entry)) {
            diffs.push(Diff::RemovedProject {
                chapter: entry.chapter.clone(),
                src: entry.src.clone(),
            });
        }
    }

    if lock.rhizz_version != current_version {
        notes.push(format!(
            "book.lock was generated with '{}', the current compiler reports '{}' (outputs still match)",
            lock.rhizz_version, current_version
        ));
    }

    (diffs, notes)
}

/// The lock identity of a trace: (chapter, input hash).
const fn entry_key(entry: &LockEntry) -> (&str, &str) {
    (entry.chapter.as_str(), entry.input_sha256.as_str())
}

/// The lock identity of a project trace: (chapter, src, input hash). The
/// input hash is part of the key so changed sources surface as a
/// removed/new pair even when the compiler verdict is unchanged (the
/// rendered iframe payload still changed); an identical key with a different
/// verdict means the compiler itself changed its output.
const fn project_key(entry: &ProjectLockEntry) -> (&str, &str, &str) {
    (
        entry.chapter.as_str(),
        entry.src.as_str(),
        entry.input_sha256.as_str(),
    )
}

/// Sort lock entries by (chapter, input hash) for a stable file.
#[must_use]
pub fn sorted_entries(mut entries: Vec<LockEntry>) -> Vec<LockEntry> {
    entries.sort_by(|left, right| {
        left.chapter
            .cmp(&right.chapter)
            .then_with(|| left.input_sha256.cmp(&right.input_sha256))
    });
    entries
}

/// Sort project lock entries by (chapter, src) for a stable file.
#[must_use]
pub fn sorted_projects(mut projects: Vec<ProjectLockEntry>) -> Vec<ProjectLockEntry> {
    projects.sort_by(|left, right| {
        left.chapter
            .cmp(&right.chapter)
            .then_with(|| left.src.cmp(&right.src))
    });
    projects
}

#[cfg(test)]
mod tests {
    use super::{
        Diff, LOCK_FORMAT, LockEntry, LockPayload, ProjectFileEntry, ProjectLockEntry, accept_flag,
        colorize_unified_diff, compare_lock, format_diff, lock_path, short_sha, sorted_entries,
        sorted_projects,
    };
    use crate::normalize::{NormDiagnostic, NormalizedOutput};
    use std::path::Path;

    fn entry(chapter: &str, hash: &str, output: NormalizedOutput) -> LockEntry {
        LockEntry {
            chapter: chapter.to_owned(),
            hcl: "x".to_owned(),
            input_sha256: hash.to_owned(),
            output,
        }
    }

    fn output(errors: Vec<NormDiagnostic>) -> NormalizedOutput {
        NormalizedOutput {
            errors,
            warnings: vec![],
            score: None,
        }
    }

    fn payload(entries: Vec<LockEntry>, version: &str) -> LockPayload {
        LockPayload {
            entries,
            format: LOCK_FORMAT,
            projects: Vec::new(),
            rhizz_version: version.to_owned(),
        }
    }

    fn project(chapter: &str, src: &str, output: NormalizedOutput) -> ProjectLockEntry {
        ProjectLockEntry {
            chapter: chapter.to_owned(),
            files: vec![ProjectFileEntry {
                path: "system.hcl".to_owned(),
                sha256: "abc".to_owned(),
            }],
            input_sha256: "def".to_owned(),
            output,
            src: src.to_owned(),
        }
    }

    #[test]
    fn lock_path_is_book_root_joined() {
        assert_eq!(
            lock_path(Path::new("/tmp/book")),
            std::path::PathBuf::from("/tmp/book/book.lock")
        );
    }

    #[test]
    fn accept_flag_truthy_and_falsey_values() {
        for value in ["1", "yes", "true", "Y", "TRUE"] {
            assert!(accept_flag(Some(value)));
        }
        for value in ["", "0", "false", "no", "No"] {
            assert!(!accept_flag(Some(value)));
        }
        assert!(!accept_flag(None));
    }

    #[test]
    fn entries_sorted_by_chapter_then_hash() {
        let entries = vec![
            entry("b.md", "9", output(vec![])),
            entry("a.md", "8", output(vec![])),
            entry("a.md", "7", output(vec![])),
        ];
        let sorted = sorted_entries(entries);
        let keys: Vec<(&str, &str)> = sorted
            .iter()
            .map(|e| (e.chapter.as_str(), e.input_sha256.as_str()))
            .collect();
        assert_eq!(keys, vec![("a.md", "7"), ("a.md", "8"), ("b.md", "9")]);
    }

    #[test]
    fn matching_lock_has_no_diffs() {
        let blocks = vec![entry("a.md", "1", output(vec![]))];
        let lock = payload(blocks.clone(), "rhizz 0.1.0");
        let (diffs, notes) = compare_lock(&lock, &blocks, &[], "rhizz 0.1.0");
        assert!(diffs.is_empty());
        assert!(notes.is_empty());
    }

    #[test]
    fn new_block_detected() {
        let blocks = vec![entry("a.md", "1", output(vec![]))];
        let lock = payload(vec![], "rhizz 0.1.0");
        let (diffs, _) = compare_lock(&lock, &blocks, &[], "rhizz 0.1.0");
        assert_eq!(
            diffs,
            vec![Diff::NewBlock {
                chapter: "a.md".to_owned(),
                hash: "1".to_owned(),
            }]
        );
        assert!(format_diff(&diffs[0], false).contains("new block in 'a.md'"));
    }

    #[test]
    fn removed_block_detected() {
        let lock = payload(vec![entry("a.md", "1", output(vec![]))], "rhizz 0.1.0");
        let (diffs, _) = compare_lock(&lock, &[], &[], "rhizz 0.1.0");
        assert_eq!(
            diffs,
            vec![Diff::RemovedBlock {
                chapter: "a.md".to_owned(),
                hash: "1".to_owned(),
            }]
        );
        assert!(format_diff(&diffs[0], false).contains("removed from the book"));
    }

    #[test]
    fn changed_output_detected_and_shows_both_sides() {
        let blocks = vec![entry(
            "a.md",
            "1",
            output(vec![NormDiagnostic {
                code: "E001".to_owned(),
                line: None,
                message: "new".to_owned(),
            }]),
        )];
        let locked = vec![entry(
            "a.md",
            "1",
            output(vec![NormDiagnostic {
                code: "E002".to_owned(),
                line: None,
                message: "old".to_owned(),
            }]),
        )];
        let lock = payload(locked, "rhizz 0.1.0");
        let (diffs, _) = compare_lock(&lock, &blocks, &[], "rhizz 0.1.0");
        assert_eq!(diffs.len(), 1);
        let Diff::OutputChanged {
            chapter,
            hash,
            old,
            new,
        } = &diffs[0]
        else {
            panic!("expected OutputChanged");
        };
        assert_eq!(chapter, "a.md");
        assert_eq!(hash, "1");
        assert_eq!(old.errors[0].code, "E002"); // lock shows old
        assert_eq!(new.errors[0].code, "E001"); // now shows new
    }

    #[test]
    fn output_changed_diff_renders_git_style_unified_diff() {
        let old = output(vec![NormDiagnostic {
            code: "E002".to_owned(),
            line: None,
            message: "old".to_owned(),
        }]);
        let new = output(vec![NormDiagnostic {
            code: "E001".to_owned(),
            line: None,
            message: "new".to_owned(),
        }]);
        let rendered = format_diff(
            &Diff::OutputChanged {
                chapter: "greeter.md".to_owned(),
                hash: "8524fa00c3378f9180548b8eac3376979f955fe5a5e000d06b3f0c3c04ef31e8".to_owned(),
                old: Box::new(old),
                new: Box::new(new),
            },
            false,
        );
        assert!(rendered.contains("output changed for block in 'greeter.md'"));
        assert!(rendered.contains("8524fa00"));
        assert!(rendered.contains("    --- book.lock"));
        assert!(rendered.contains("    +++ current compiler"));
        assert!(rendered.contains("@@"));
        assert!(rendered.contains("-      \"code\": \"E002\","));
        assert!(rendered.contains("+      \"code\": \"E001\","));
        assert!(rendered.contains("-      \"message\": \"old\""));
        // No stray lock:/now: one-liners anymore.
        assert!(!rendered.contains("    lock: {"));
        assert!(!rendered.contains("    now:  {"));
    }

    #[test]
    fn format_mismatch_detected() {
        let blocks = vec![entry("a.md", "1", output(vec![]))];
        let mut lock = payload(blocks.clone(), "rhizz 0.1.0");
        lock.format = 99;
        let (diffs, _) = compare_lock(&lock, &blocks, &[], "rhizz 0.1.0");
        assert_eq!(diffs, vec![Diff::FormatMismatch { found: 99 }]);
        assert!(format_diff(&diffs[0], false).contains("lock format 99"));
    }

    #[test]
    fn version_drift_is_a_note_not_a_diff() {
        let blocks = vec![entry("a.md", "1", output(vec![]))];
        let lock = payload(blocks.clone(), "rhizz 0.1.0");
        let (diffs, notes) = compare_lock(&lock, &blocks, &[], "rhizz 0.2.0");
        assert!(diffs.is_empty());
        assert_eq!(notes.len(), 1);
        assert!(notes[0].contains("0.1.0"));
    }

    #[test]
    fn short_sha_is_first_eight_chars() {
        assert_eq!(short_sha("12345678abcdef"), "12345678");
        assert_eq!(short_sha("123"), "123");
    }

    #[test]
    fn render_pretty_matches_lock_serialization() {
        let o = output(vec![NormDiagnostic {
            code: "E001".to_owned(),
            line: None,
            message: "m".to_owned(),
        }]);
        // The pretty form rendered in diffs must re-parse to the same verdict
        // the lock entries serialize as, so a mismatch diffs like with like.
        let pretty = serde_json::to_string_pretty(&o).expect("serialize output");
        assert!(pretty.contains("\n  \"errors\": ["));
        let parsed: NormalizedOutput =
            serde_json::from_str(&pretty).expect("pretty json should reparse");
        assert_eq!(parsed, o);
    }

    #[test]
    fn output_changed_diff_is_plain_without_color() {
        let old = output(vec![NormDiagnostic {
            code: "E002".to_owned(),
            line: None,
            message: "old".to_owned(),
        }]);
        let new = output(vec![NormDiagnostic {
            code: "E001".to_owned(),
            line: None,
            message: "new".to_owned(),
        }]);
        let rendered = format_diff(
            &Diff::OutputChanged {
                chapter: "greeter.md".to_owned(),
                hash: "8524fa00c3378f9180548b8eac3376979f955fe5a5e000d06b3f0c3c04ef31e8".to_owned(),
                old: Box::new(old),
                new: Box::new(new),
            },
            false,
        );
        // No ANSI escapes, ever, when color is disabled.
        assert!(!rendered.contains('\x1b'));
        assert!(rendered.contains("-      \"code\": \"E002\","));
    }

    #[test]
    fn colorize_unified_diff_uses_git_scheme() {
        let diff = [
            "--- book.lock",
            "+++ current compiler",
            "@@ -11,7 +11,7 @@",
            "       \"warnings\": [",
            "-      \"code\": \"W999\",",
            "+      \"code\": \"W005\",",
            "        \"message\": \"same\",",
        ]
        .join("\n");
        let colored = colorize_unified_diff(&diff);
        let lines: Vec<&str> = colored.lines().collect();
        // Headers bold yellow, hunk cyan, removal red, addition green, context plain.
        assert!(lines[0].starts_with("\x1b[33;1m") && lines[0].ends_with("\x1b[0m"));
        assert!(lines[1].starts_with("\x1b[33;1m"));
        assert!(lines[2].starts_with("\x1b[36m"));
        assert_eq!(lines[3], "       \"warnings\": [");
        assert!(lines[4].starts_with("\x1b[31m"));
        assert!(lines[5].starts_with("\x1b[32m"));
        // Content survives intact next to the codes.
        assert!(lines[4].contains("\"code\": \"W999\","));
        assert!(lines[6].starts_with("        \"message\": \"same\","));
    }

    #[test]
    fn colorize_handles_nested_indentation() {
        // format_diff indents every diff line by four spaces; detection must
        // trim before matching so colors still apply.
        let diff = "    - a\n    + b\n      c\n";
        let colored = colorize_unified_diff(diff);
        assert!(colored.contains("\x1b[31m    - a\x1b[0m"));
        assert!(colored.contains("\x1b[32m    + b\x1b[0m"));
        assert!(colored.contains("      c"));
    }

    #[test]
    fn lock_payload_round_trips_through_json() {
        let payload = payload(vec![entry("a.md", "1", output(vec![]))], "rhizz 0.1.0");
        let text = serde_json::to_string_pretty(&payload).unwrap_or_default();
        let parsed: LockPayload = serde_json::from_str(&text).expect("lock json should parse");
        assert_eq!(parsed, payload);
    }

    #[test]
    fn legacy_lock_without_projects_parses_to_empty() {
        let text = r#"{"entries": [], "format": 1, "rhizz_version": "rhizz 0.1.0"}"#;
        let parsed: LockPayload = serde_json::from_str(text).expect("legacy lock should parse");
        assert!(parsed.projects.is_empty());
    }

    #[test]
    fn projects_sorted_by_chapter_then_src() {
        let projects = vec![
            project("b.md", "projects/z", output(vec![])),
            project("a.md", "projects/b", output(vec![])),
            project("a.md", "projects/a", output(vec![])),
        ];
        let sorted = sorted_projects(projects);
        let keys: Vec<(&str, &str)> = sorted
            .iter()
            .map(|entry| (entry.chapter.as_str(), entry.src.as_str()))
            .collect();
        assert_eq!(
            keys,
            vec![
                ("a.md", "projects/a"),
                ("a.md", "projects/b"),
                ("b.md", "projects/z"),
            ]
        );
    }

    #[test]
    fn new_and_removed_projects_detected() {
        let projects = vec![project("a.md", "projects/demo", output(vec![]))];
        let lock = payload(vec![], "rhizz 0.1.0");
        let (diffs, _) = compare_lock(&lock, &[], &projects, "rhizz 0.1.0");
        assert_eq!(
            diffs,
            vec![Diff::NewProject {
                chapter: "a.md".to_owned(),
                src: "projects/demo".to_owned(),
            }]
        );
        assert!(format_diff(&diffs[0], false).contains("new project 'projects/demo' in 'a.md'"));

        let (diffs, _) = compare_lock(&payload(vec![], "rhizz 0.1.0"), &[], &[], "rhizz 0.1.0");
        assert!(diffs.is_empty());
        let mut lock = payload(vec![], "rhizz 0.1.0");
        lock.projects = projects;
        let (diffs, _) = compare_lock(&lock, &[], &[], "rhizz 0.1.0");
        assert_eq!(
            diffs,
            vec![Diff::RemovedProject {
                chapter: "a.md".to_owned(),
                src: "projects/demo".to_owned(),
            }]
        );
        assert!(format_diff(&diffs[0], false).contains("was removed from the book"));
    }

    #[test]
    fn changed_project_output_detected() {
        let current = vec![project(
            "a.md",
            "projects/demo",
            output(vec![crate::normalize::NormDiagnostic {
                code: "W001".to_owned(),
                line: None,
                message: "new".to_owned(),
            }]),
        )];
        let mut lock = payload(vec![], "rhizz 0.1.0");
        lock.projects = vec![project("a.md", "projects/demo", output(vec![]))];
        let (diffs, _) = compare_lock(&lock, &[], &current, "rhizz 0.1.0");
        assert_eq!(diffs.len(), 1);
        let Diff::ProjectOutputChanged { chapter, src, .. } = &diffs[0] else {
            panic!("expected ProjectOutputChanged");
        };
        assert_eq!(chapter, "a.md");
        assert_eq!(src, "projects/demo");
        assert!(
            format_diff(&diffs[0], false)
                .contains("output changed for project 'projects/demo' in 'a.md'")
        );
    }

    #[test]
    fn matching_projects_have_no_diffs() {
        let projects = vec![project("a.md", "projects/demo", output(vec![]))];
        let mut lock = payload(vec![], "rhizz 0.1.0");
        lock.projects = projects.clone();
        let (diffs, notes) = compare_lock(&lock, &[], &projects, "rhizz 0.1.0");
        assert!(diffs.is_empty());
        assert!(notes.is_empty());
    }
}
