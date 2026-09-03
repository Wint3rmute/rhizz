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

/// The whole lock payload.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LockPayload {
    /// Per-block traces, sorted by (chapter, input hash).
    pub entries: Vec<LockEntry>,
    /// Lock format version; bumped when the entry schema changes.
    pub format: u64,
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
#[must_use]
pub fn render_output(output: &NormalizedOutput) -> String {
    serde_json::to_string(output).unwrap_or_else(|_| "<unserializable>".to_owned())
}

/// Compare the current block traces against the existing lock.
///
/// Returns (diffs, notes): diffs abort the build (unless accepting changes);
/// notes are informational metadata drift (version changed, outputs match).
#[must_use]
pub fn compare_lock(
    lock: &LockPayload,
    blocks: &[LockEntry],
    current_version: &str,
) -> (Vec<String>, Vec<String>) {
    let mut diffs = Vec::new();
    let mut notes = Vec::new();

    if lock.format != LOCK_FORMAT {
        diffs.push(format!(
            "book.lock uses lock format {}, expected {} (regenerate with BOOKLOCK_ACCEPT_CHANGES=1)",
            lock.format, LOCK_FORMAT
        ));
        return (diffs, notes);
    }

    let locked: HashSet<(&str, &str)> = lock.entries.iter().map(entry_key).collect();

    for block in blocks {
        if !locked.contains(&entry_key(block)) {
            diffs.push(format!(
                "new block in '{}' (input {}) is not present in book.lock",
                block.chapter,
                short_sha(&block.input_sha256)
            ));
            continue;
        }
        if let Some(previous) = lock
            .entries
            .iter()
            .find(|entry| entry_key(entry) == entry_key(block))
            && previous.output != block.output
        {
            diffs.push(format!(
                "output changed for block in '{}' (input {}):\n    lock: {}\n    now:  {}",
                block.chapter,
                short_sha(&block.input_sha256),
                render_output(&previous.output),
                render_output(&block.output)
            ));
        }
    }

    let current: HashSet<(&str, &str)> = blocks.iter().map(entry_key).collect();
    for entry in &lock.entries {
        if !current.contains(&entry_key(entry)) {
            diffs.push(format!(
                "block in '{}' (input {}) was removed from the book but is still present in book.lock",
                entry.chapter,
                short_sha(&entry.input_sha256)
            ));
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

#[cfg(test)]
mod tests {
    use super::{
        LOCK_FORMAT, LockEntry, LockPayload, accept_flag, compare_lock, lock_path, render_output,
        short_sha, sorted_entries,
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
            rhizz_version: version.to_owned(),
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
        let (diffs, notes) = compare_lock(&lock, &blocks, "rhizz 0.1.0");
        assert!(diffs.is_empty());
        assert!(notes.is_empty());
    }

    #[test]
    fn new_block_detected() {
        let blocks = vec![entry("a.md", "1", output(vec![]))];
        let lock = payload(vec![], "rhizz 0.1.0");
        let (diffs, _) = compare_lock(&lock, &blocks, "rhizz 0.1.0");
        assert_eq!(diffs.len(), 1);
        assert!(diffs[0].contains("new block"));
        assert!(diffs[0].contains("a.md"));
    }

    #[test]
    fn removed_block_detected() {
        let lock = payload(vec![entry("a.md", "1", output(vec![]))], "rhizz 0.1.0");
        let (diffs, _) = compare_lock(&lock, &[], "rhizz 0.1.0");
        assert_eq!(diffs.len(), 1);
        assert!(diffs[0].contains("removed"));
        assert!(diffs[0].contains("a.md"));
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
        let (diffs, _) = compare_lock(&lock, &blocks, "rhizz 0.1.0");
        assert_eq!(diffs.len(), 1);
        assert!(diffs[0].contains("output changed"));
        assert!(diffs[0].contains("E002")); // lock shows old
        assert!(diffs[0].contains("E001")); // now shows new
    }

    #[test]
    fn format_mismatch_detected() {
        let blocks = vec![entry("a.md", "1", output(vec![]))];
        let mut lock = payload(blocks.clone(), "rhizz 0.1.0");
        lock.format = 99;
        let (diffs, _) = compare_lock(&lock, &blocks, "rhizz 0.1.0");
        assert_eq!(diffs.len(), 1);
        assert!(diffs[0].contains("format"));
    }

    #[test]
    fn version_drift_is_a_note_not_a_diff() {
        let blocks = vec![entry("a.md", "1", output(vec![]))];
        let lock = payload(blocks.clone(), "rhizz 0.1.0");
        let (diffs, notes) = compare_lock(&lock, &blocks, "rhizz 0.2.0");
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
    fn render_output_is_compact_single_line() {
        let rendered = render_output(&output(vec![]));
        assert_eq!(rendered, "{\"errors\":[],\"warnings\":[]}");
    }

    #[test]
    fn lock_payload_round_trips_through_json() {
        let payload = payload(vec![entry("a.md", "1", output(vec![]))], "rhizz 0.1.0");
        let text = serde_json::to_string_pretty(&payload).unwrap_or_default();
        let parsed: LockPayload = serde_json::from_str(&text).expect("lock json should parse");
        assert_eq!(parsed, payload);
    }
}
