//! Chapter transformation: every `` ```rhizz `` block becomes `` ```hcl ``
//! plus a verdict panel, and its input→output trace is recorded for
//! `book.lock`.

use crate::blocks::{Segment, body_hash, parse_blocks, split_lines};
use crate::compile::Verdict;
use crate::lock::LockEntry;
use crate::render::{IGNORE_PANEL, panel_html, tool_error_panel};
use std::collections::HashMap;

/// Compiled-block results keyed by body SHA-256 digest.
pub type CompileResults = HashMap<String, Verdict>;

/// Rewrite one chapter and return its lock traces.
///
/// * `chapter_path` — chapter identity for the trace (`path`/`source_path`/`name`).
/// * `content` — original markdown.
/// * `results` — compiled verdicts for every non-ignored block body.
///
/// Returns the new chapter content (blocks replaced by `` ```hcl `` + panel)
/// and the per-block traces for `book.lock`. Ignored blocks are rendered but
/// never traced.
#[must_use]
pub fn transform_chapter(
    chapter_path: &str,
    content: &str,
    results: &CompileResults,
) -> (String, Vec<LockEntry>) {
    let segments = parse_blocks(&split_lines(content));
    let mut out: Vec<String> = Vec::new();
    let mut traces = Vec::new();

    for segment in &segments {
        match segment {
            Segment::Text(lines) => out.extend(lines.iter().cloned()),
            Segment::Block { attrs, body } => {
                let body_new = body.join("\n");
                let sha = body_hash(&body_new);

                out.push("```hcl".to_owned());
                out.extend(body.iter().cloned());
                out.push("```".to_owned());
                out.push(String::new());

                if attrs.iter().any(|attr| attr == "ignore") {
                    out.push(IGNORE_PANEL.to_owned());
                    out.push(String::new());
                    continue;
                }

                match results.get(&sha) {
                    Some(verdict) => {
                        traces.push(LockEntry {
                            chapter: chapter_path.to_owned(),
                            hcl: body_new,
                            input_sha256: sha,
                            output: verdict.sorted.clone(),
                        });
                        out.push(panel_html(verdict));
                    }
                    None => out.push(tool_error_panel("no compile result recorded")),
                }
                out.push(String::new());
            }
        }
    }

    (out.join("\n"), traces)
}

#[cfg(test)]
mod tests {
    use super::{CompileResults, transform_chapter};
    use crate::compile::Verdict;
    use std::collections::HashMap;

    fn results_with(body: &str, verdict: Verdict) -> CompileResults {
        let mut results = HashMap::new();
        results.insert(crate::blocks::body_hash(body), verdict);
        results
    }

    fn results_identity() -> CompileResults {
        HashMap::new()
    }

    #[test]
    fn records_only_compiled_blocks() {
        let raw_body = "project {\n  name = \"x\"\n}\n";
        let content = format!("# X\n\n```rhizz\n{raw_body}```\n\n```rhizz,ignore\nignored\n```\n");
        // The lock hashes the body as the joined source lines (the closing
        // fence is never part of it) — same basis as the compiler sees.
        let body = "project {\n  name = \"x\"\n}";
        let results = results_with(body, Verdict::new(vec![], vec![], None));
        let (new_content, traces) = transform_chapter("x.md", &content, &results);

        assert_eq!(traces.len(), 1);
        assert_eq!(traces[0].chapter, "x.md");
        assert_eq!(traces[0].hcl, body);
        assert_eq!(traces[0].input_sha256, crate::blocks::body_hash(body));

        // ignore blocks are rendered but not traced
        assert!(new_content.contains("Not compiled in this book"));
        assert!(new_content.contains("rhizz-diag"));
    }

    #[test]
    fn changed_content_means_new_key() {
        let first = "project {}";
        let second = "project { }";
        let results = results_with(first, Verdict::new(vec![], vec![], None));
        let (_, traces) = transform_chapter("x.md", &format!("```rhizz\n{first}\n```\n"), &results);
        assert_eq!(traces.len(), 1);
        assert_eq!(traces[0].input_sha256, crate::blocks::body_hash(first));
        assert_ne!(
            crate::blocks::body_hash(first),
            crate::blocks::body_hash(second)
        );
    }

    #[test]
    fn missing_result_renders_tool_panel_without_trace() {
        let body = "project {}";
        let (new_content, traces) = transform_chapter(
            "x.md",
            &format!("```rhizz\n{body}\n```\n"),
            &results_identity(),
        );
        assert!(traces.is_empty());
        assert!(new_content.contains("rhizz-tool"));
    }

    #[test]
    fn renders_hcl_fence_then_panel() {
        let body = "project {}";
        let results = results_with(body, Verdict::new(vec![], vec![], None));
        let (new_content, _) =
            transform_chapter("x.md", &format!("```rhizz\n{body}\n```\n"), &results);
        assert!(new_content.starts_with("```hcl\nproject {}\n```\n\n"));
        assert!(new_content.contains("<div class=\"rhizz-diag rhizz-ok\">"));
    }

    #[test]
    fn trace_chapter_key_honors_source_path() {
        let body = "project {}";
        let results = results_with(body, Verdict::new(vec![], vec![], None));
        // Protocol layer picks path > source_path > name; transform just uses
        // whatever chapter identity it is handed.
        let (_, traces) =
            transform_chapter("draft.md", &format!("```rhizz\n{body}\n```\n"), &results);
        assert_eq!(traces[0].chapter, "draft.md");
    }

    #[test]
    fn joins_segments_with_single_newlines() {
        let content = "# T\n\ntext after\n";
        let (new_content, traces) = transform_chapter("t.md", content, &results_identity());
        assert_eq!(new_content, "# T\n\ntext after");
        assert!(traces.is_empty());
    }
}
