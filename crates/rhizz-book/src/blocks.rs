//! Fenced `` ```rhizz `` code-block parsing shared with mdbook chapter text.
//!
//! Behavior mirrors the historical Python preprocessor: content is split into
//! lines like `str.splitlines()` (interior blank lines kept, a single
//! trailing newline dropped), blocks are opened by a line matching
//! `` ```rhizz <attrs> `` and closed by a line of three or more backticks.

use sha2::{Digest, Sha256};

/// One segment of a markdown chapter: plain text, a `` ```rhizz `` block, or
/// a `` ```rhizz-project `` embed directive.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Segment {
    /// Plain markdown lines.
    Text(Vec<String>),
    /// A rhizz fenced block with its attribute set and raw body lines.
    Block {
        /// Attributes parsed from the info string (e.g. `ignore`).
        attrs: Vec<String>,
        /// Body lines between the fences (the closing fence is never included).
        body: Vec<String>,
    },
    /// A rhizz-project embed directive. `attrs` is the raw attribute string
    /// after the `rhizz-project` tag (parsed by `project::parse_project_attrs`);
    /// `body` holds the fence body lines, which are currently ignored.
    ProjectBlock {
        /// Raw attribute string (e.g. `src="projects/demo" height="600"`).
        attrs: String,
        /// Fence body lines (currently ignored).
        body: Vec<String>,
    },
}

/// Split content into lines, dropping a single trailing empty line.
#[must_use]
pub fn split_lines(content: &str) -> Vec<String> {
    let mut lines: Vec<String> = content.split('\n').map(str::to_owned).collect();
    if lines.last().is_some_and(String::is_empty) {
        lines.pop();
    }
    lines
}

/// Detect an opening `` ```rhizz-project `` fence; returns the raw attribute
/// string that follows the tag (e.g. `src="projects/demo"`).
///
/// Must be checked before [`fence_open_attrs`]: every project fence also
/// matches the plain `rhizz` prefix.
#[must_use]
pub fn fence_project_attrs(line: &str) -> Option<&str> {
    let line = line.trim_start_matches([' ', '\t']);
    let rest = line.strip_prefix("```")?;
    let rest = rest.trim_start_matches([' ', '\t']);
    let rest = rest.strip_prefix("rhizz-project")?;
    // Require a boundary after the tag so `rhizz-projects` (or similar)
    // does not match.
    match rest.chars().next() {
        None | Some(' ' | '\t') => Some(rest.trim_start_matches([' ', '\t'])),
        _ => None,
    }
}

/// Detect an opening `` ```rhizz `` fence; returns the attribute suffix that
/// follows the tag (e.g. `,ignore`).
#[must_use]
pub fn fence_open_attrs(line: &str) -> Option<&str> {
    let line = line.trim_start_matches([' ', '\t']);
    let rest = line.strip_prefix("```")?;
    let rest = rest.trim_start_matches([' ', '\t']);
    let rest = rest.strip_prefix("rhizz")?;
    let rest = rest.trim_start_matches([' ', '\t']);
    Some(rest)
}

/// Detect a closing fence: three or more backticks with optional trailing
/// whitespace and leading indentation.
#[must_use]
pub fn is_fence_close(line: &str) -> bool {
    let line = line.trim_start_matches([' ', '\t']);
    let Some(rest) = line.strip_prefix("```") else {
        return false;
    };
    rest.chars().all(|c| c == '`' || c.is_whitespace())
}

/// Split a fence attribute suffix on commas/whitespace, dropping empties.
#[must_use]
pub fn parse_attrs(raw: &str) -> Vec<String> {
    raw.split(|c: char| c == ',' || c.is_whitespace())
        .filter(|attr| !attr.is_empty())
        .map(String::from)
        .collect()
}

/// Split chapter lines into text and block segments, preserving order.
#[must_use]
pub fn parse_blocks(lines: &[String]) -> Vec<Segment> {
    let mut segments = Vec::new();
    let mut text = Vec::new();

    let mut index = 0;
    while let Some(line) = lines.get(index) {
        if let Some(attrs_raw) = fence_project_attrs(line) {
            if !text.is_empty() {
                segments.push(Segment::Text(std::mem::take(&mut text)));
            }
            let mut body = Vec::new();
            index = index.saturating_add(1);
            while let Some(body_line) = lines.get(index) {
                if is_fence_close(body_line) {
                    break;
                }
                body.push(body_line.clone());
                index = index.saturating_add(1);
            }
            if lines.get(index).is_some() {
                index = index.saturating_add(1);
            }
            segments.push(Segment::ProjectBlock {
                attrs: attrs_raw.to_owned(),
                body,
            });
        } else if let Some(attrs_raw) = fence_open_attrs(line) {
            if !text.is_empty() {
                segments.push(Segment::Text(std::mem::take(&mut text)));
            }
            let attrs = parse_attrs(attrs_raw);
            let mut body = Vec::new();
            index = index.saturating_add(1);
            while let Some(body_line) = lines.get(index) {
                if is_fence_close(body_line) {
                    break;
                }
                body.push(body_line.clone());
                index = index.saturating_add(1);
            }
            // Skip the closing fence when one was found.
            if lines.get(index).is_some() {
                index = index.saturating_add(1);
            }
            segments.push(Segment::Block { attrs, body });
        } else {
            text.push(line.clone());
            index = index.saturating_add(1);
        }
    }
    if !text.is_empty() {
        segments.push(Segment::Text(std::mem::take(&mut text)));
    }
    segments
}

/// SHA-256 hex digest of a block body (the `book.lock` input key).
#[must_use]
pub fn body_hash(body: &str) -> String {
    let digest = Sha256::digest(body.as_bytes());
    format!("{digest:x}")
}

#[cfg(test)]
mod tests {
    use super::{
        Segment, body_hash, fence_open_attrs, fence_project_attrs, is_fence_close, parse_attrs,
        parse_blocks, split_lines,
    };

    #[test]
    fn split_lines_drops_single_trailing_newline() {
        assert_eq!(split_lines("a\n"), vec!["a".to_owned()]);
        assert_eq!(split_lines("a\n\n"), vec!["a".to_owned(), String::new()]);
        assert_eq!(split_lines("a\nb"), vec!["a".to_owned(), "b".to_owned()]);
        assert_eq!(split_lines(""), Vec::<String>::new());
    }

    #[test]
    fn fence_open_matches_tag_with_optional_indentation_and_attrs() {
        assert_eq!(fence_open_attrs("```rhizz"), Some(""));
        assert_eq!(fence_open_attrs("  ```rhizz,ignore"), Some(",ignore"));
        assert_eq!(fence_open_attrs("```rhizz ignore"), Some("ignore"));
        assert_eq!(fence_open_attrs("```hcl"), None);
        assert_eq!(fence_open_attrs("``rhizz"), None);
        assert_eq!(fence_open_attrs("text ```rhizz"), None);
    }

    #[test]
    fn fence_close_matches_three_or_more_backticks() {
        assert!(is_fence_close("```"));
        assert!(is_fence_close("   ```   "));
        assert!(is_fence_close("````"));
        assert!(!is_fence_close("``"));
        assert!(!is_fence_close("```hcl"));
        assert!(!is_fence_close("`` `"));
    }

    #[test]
    fn attrs_split_on_commas_and_whitespace() {
        assert_eq!(parse_attrs(""), Vec::<String>::new());
        assert_eq!(parse_attrs(",ignore"), vec!["ignore".to_owned()]);
        assert_eq!(parse_attrs("ignore"), vec!["ignore".to_owned()]);
        assert_eq!(
            parse_attrs("a, b\tc"),
            vec!["a".to_owned(), "b".to_owned(), "c".to_owned()]
        );
    }

    #[test]
    fn parse_blocks_roundtrip_matches_python_segmentation() {
        let content = "# T\n\n```rhizz,ignore\nproject {}\n```\n\ntext\n";
        let segments = parse_blocks(&split_lines(content));
        assert_eq!(
            segments[0],
            Segment::Text(vec!["# T".to_owned(), String::new()])
        );
        assert_eq!(
            segments[1],
            Segment::Block {
                attrs: vec!["ignore".to_owned()],
                body: vec!["project {}".to_owned()],
            }
        );
        // split_lines drops the final newline, so no trailing empty line.
        assert_eq!(
            segments[2],
            Segment::Text(vec![String::new(), "text".to_owned()])
        );
    }

    #[test]
    fn parse_blocks_keeps_consecutive_blocks() {
        let content = "```rhizz\none\n```\n```rhizz\n two \n```\n";
        let segments = parse_blocks(&split_lines(content));
        assert_eq!(segments.len(), 2);
        if let Segment::Block { attrs, body } = &segments[0] {
            assert!(attrs.is_empty());
            assert_eq!(body, &vec!["one".to_owned()]);
        } else {
            panic!("expected first segment to be a block");
        }
        if let Segment::Block { body, .. } = &segments[1] {
            assert_eq!(body, &vec![" two ".to_owned()]);
        } else {
            panic!("expected second segment to be a block");
        }
    }

    #[test]
    fn project_fence_open_matches_tag_with_attrs() {
        assert_eq!(
            fence_project_attrs("```rhizz-project src=\"projects/demo\""),
            Some("src=\"projects/demo\"")
        );
        assert_eq!(fence_project_attrs("  ```rhizz-project"), Some(""));
        assert_eq!(fence_project_attrs("```rhizz"), None);
        assert_eq!(fence_project_attrs("```rhizz,ignore"), None);
        // A longer tag sharing the prefix must not match.
        assert_eq!(fence_project_attrs("```rhizz-projects"), None);
    }

    #[test]
    fn parse_blocks_takes_project_fence_before_plain_rhizz() {
        let content = "```rhizz-project src=\"projects/demo\"\nCaption here\n```\n";
        let segments = parse_blocks(&split_lines(content));
        assert_eq!(segments.len(), 1);
        assert_eq!(
            segments[0],
            Segment::ProjectBlock {
                attrs: "src=\"projects/demo\"".to_owned(),
                body: vec!["Caption here".to_owned()],
            }
        );
    }

    #[test]
    fn parse_blocks_project_fence_may_have_empty_body() {
        let content = "```rhizz-project src=\"projects/demo\"\n```\n";
        let segments = parse_blocks(&split_lines(content));
        assert_eq!(segments.len(), 1);
        assert_eq!(
            segments[0],
            Segment::ProjectBlock {
                attrs: "src=\"projects/demo\"".to_owned(),
                body: Vec::new(),
            }
        );
    }

    #[test]
    fn body_hash_is_deterministic_and_content_sensitive() {
        assert_eq!(body_hash("project {}"), body_hash("project {}"));
        assert_ne!(body_hash("project {}"), body_hash("project { }"));
        assert_eq!(body_hash("project {}").len(), 64);
    }
}
