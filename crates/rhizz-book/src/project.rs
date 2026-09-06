//! `rhizz-project` embed directives: whole example projects in the book.
//!
//! An author embeds a project with a fenced block tagged
//! `rhizz-project src="projects/demo"` (plus an optional `height` and an
//! optional caption body), pointing at a directory under `<book>/src/`.
//!
//! The preprocessor loads every `.hcl` file under `<book>/src/<src>/`,
//! compiles the model sources for `book.lock` verification, and renders an
//! `<iframe>` pointing at the deployed `/book-example` route with the whole
//! project carried in the URL hash (`#p=`). The hash payload uses exactly the
//! codec the web route decodes: JSON → zlib deflate → base64url (no padding).

use crate::blocks::body_hash;
use crate::compile::{Verdict, normalize_result};
use anyhow::{Context, Result, bail};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use flate2::{Compression, write::ZlibEncoder};
use rhizz_core::{Source, compile};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fmt::Write as _;
use std::fs;
use std::io::Write as _;
use std::path::{Path, PathBuf};

/// URL-hash payloads for every referenced project, keyed by fence `src`.
pub type ProjectPayloads = HashMap<String, String>;
/// `[preprocessor.rhizz] book-example-base-url`.
pub const DEFAULT_EXAMPLE_BASE_URL: &str = "https://rhizz.fly.dev";

/// iframe height (px) when the fence sets no `height`.
pub const DEFAULT_PROJECT_HEIGHT: u32 = 500;

/// Payload format version; must match `BOOK_PAYLOAD_VERSION` in
/// `web/src/routes/book-example/payload.ts`.
const BOOK_PAYLOAD_VERSION: u32 = 1;

/// Attributes of one `rhizz-project` fence.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectAttrs {
    /// Project directory, relative to `<book>/src/` (e.g. `projects/demo`).
    pub src: String,
    /// iframe height in px.
    pub height: u32,
}

/// Split an attribute string into whitespace-separated `key="value"` tokens,
/// keeping quoted values with inner spaces intact.
fn split_attr_tokens(raw: &str) -> Result<Vec<String>> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    for ch in raw.chars() {
        if ch == '"' {
            in_quotes = !in_quotes;
            current.push(ch);
        } else if ch.is_whitespace() && !in_quotes {
            if !current.is_empty() {
                tokens.push(std::mem::take(&mut current));
            }
        } else {
            current.push(ch);
        }
    }
    if in_quotes {
        bail!("unterminated quote in rhizz-project attributes: {raw:?}");
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    Ok(tokens)
}

/// Parse the attribute string of a `rhizz-project` fence (`src` is required,
/// `height` is optional).
///
/// # Errors
///
/// Returns an error for malformed tokens, unknown keys, a missing `src`, or
/// an invalid `height`.
pub fn parse_project_attrs(raw: &str) -> Result<ProjectAttrs> {
    let mut src: Option<String> = None;
    let mut height = DEFAULT_PROJECT_HEIGHT;
    for token in split_attr_tokens(raw)? {
        let Some((key, quoted)) = token.split_once('=') else {
            bail!("malformed rhizz-project attribute {token:?}: expected key=\"value\"");
        };
        let value = quoted
            .strip_prefix('"')
            .and_then(|inner| inner.strip_suffix('"'))
            .unwrap_or(quoted);
        match key {
            "src" => src = Some(value.to_owned()),
            "height" => {
                height = value
                    .parse::<u32>()
                    .with_context(|| format!("invalid height {value:?}: expected a pixel count"))?;
                if height == 0 {
                    bail!("invalid height \"0\": expected a positive pixel count");
                }
            }
            _ => bail!("unknown rhizz-project attribute {key:?} (expected src, height)"),
        }
    }
    let Some(src) = src else {
        bail!("rhizz-project fence is missing the required src=\"...\" attribute");
    };
    if src.is_empty() {
        bail!("rhizz-project src must not be empty");
    }
    Ok(ProjectAttrs { src, height })
}

/// One `.hcl` file of a book project.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectFile {
    /// POSIX-style path relative to the project dir (e.g. `diagrams/main.hcl`).
    pub path: String,
    /// Raw file content.
    pub content: String,
    /// SHA-256 hex digest of the content.
    pub sha256: String,
}

/// A loaded book project: `.hcl` files sorted by path plus the input hash.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoadedProject {
    /// Files sorted by path.
    pub files: Vec<ProjectFile>,
    /// SHA-256 over the whole set (`path\0content\0` per file, in order).
    pub input_sha256: String,
}

/// Reject path components that could escape the project directory.
fn check_src_segments(src: &str) -> Result<()> {
    if src.is_empty() {
        bail!("project src must not be empty");
    }
    for segment in src.split('/') {
        if segment.is_empty() || segment == "." || segment == ".." {
            bail!(
                "project src {src:?} must be a relative path without '.', '..' or empty segments"
            );
        }
    }
    if src.starts_with('/') || src.starts_with('\\') {
        bail!("project src {src:?} must be relative, not absolute");
    }
    Ok(())
}

/// Recursively collect `.hcl` files under `dir`, recording paths relative to
/// `base`. Dotfiles/dot-directories and symlinks are skipped; entries are
/// visited in sorted order for determinism.
fn collect_hcl(base: &Path, dir: &Path, out: &mut Vec<(String, String)>) -> Result<()> {
    let mut entries: Vec<PathBuf> = fs::read_dir(dir)
        .with_context(|| format!("cannot list {}", dir.display()))?
        .map(|entry| entry.map(|entry| entry.path()))
        .collect::<std::result::Result<_, _>>()
        .with_context(|| format!("cannot list {}", dir.display()))?;
    entries.sort();
    for path in entries {
        let name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default();
        if name.starts_with('.') {
            continue;
        }
        let meta = fs::symlink_metadata(&path)
            .with_context(|| format!("cannot stat {}", path.display()))?;
        if meta.file_type().is_symlink() {
            continue;
        }
        if meta.is_dir() {
            collect_hcl(base, &path, out)?;
        } else if meta.is_file() && path.extension().is_some_and(|ext| ext == "hcl") {
            let rel = path
                .strip_prefix(base)
                .with_context(|| format!("{} escaped {}", path.display(), base.display()))?;
            let rel_posix = rel.to_string_lossy().replace('\\', "/");
            let content = fs::read_to_string(&path)
                .with_context(|| format!("cannot read {}", path.display()))?;
            out.push((rel_posix, content));
        }
    }
    Ok(())
}

/// Load every `.hcl` file of the project at `<src_root>/<src>/`.
///
/// # Errors
///
/// Returns an error when `src` is unsafe, the directory cannot be read, or it
/// contains no `.hcl` files.
pub fn load_project(src_root: &Path, src: &str) -> Result<LoadedProject> {
    check_src_segments(src)?;
    let base = src_root.join(src);
    let base = base.canonicalize().with_context(|| {
        format!(
            "book project {src:?} not found under {}",
            src_root.display()
        )
    })?;
    let root = src_root
        .canonicalize()
        .with_context(|| format!("cannot resolve {}", src_root.display()))?;
    if !base.starts_with(&root) {
        bail!("book project {src:?} escapes {}", src_root.display());
    }
    let mut raw: Vec<(String, String)> = Vec::new();
    collect_hcl(&base, &base, &mut raw)?;
    if raw.is_empty() {
        bail!("book project {src:?} contains no .hcl files");
    }
    let mut files = Vec::with_capacity(raw.len());
    let mut hasher = Sha256::new();
    for (path, content) in raw {
        hasher.update(path.as_bytes());
        hasher.update([0]);
        hasher.update(content.as_bytes());
        hasher.update([0]);
        files.push(ProjectFile {
            sha256: body_hash(&content),
            path,
            content,
        });
    }
    Ok(LoadedProject {
        files,
        input_sha256: format!("{:x}", hasher.finalize()),
    })
}

/// Compile a loaded project's model sources (every `.hcl` file except diagram
/// layouts — mirroring `readProjectSources` on the web side).
#[must_use]
pub fn compile_project(files: &[ProjectFile]) -> Verdict {
    let sources: Vec<Source> = files
        .iter()
        .filter(|file| !file.path.starts_with("diagrams/"))
        .map(|file| Source {
            filename: file.path.clone(),
            content: file.content.clone(),
        })
        .collect();
    normalize_result(&compile(&sources))
}

#[derive(Serialize)]
struct PayloadFile<'a> {
    path: &'a str,
    content: &'a str,
}

#[derive(Serialize)]
struct Payload<'a> {
    version: u32,
    files: Vec<PayloadFile<'a>>,
}

/// Encode project files into the URL-hash payload the `/book-example` route
/// decodes (JSON → zlib deflate → base64url, no padding).
///
/// # Errors
///
/// Returns an error when serialization or compression fails (should not
/// happen for in-memory data).
pub fn encode_payload(files: &[ProjectFile]) -> Result<String> {
    let payload = Payload {
        version: BOOK_PAYLOAD_VERSION,
        files: files
            .iter()
            .map(|file| PayloadFile {
                path: file.path.as_str(),
                content: file.content.as_str(),
            })
            .collect(),
    };
    let json = serde_json::to_string(&payload).context("serialize book project payload")?;
    let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
    encoder
        .write_all(json.as_bytes())
        .context("deflate book project payload")?;
    let compressed = encoder.finish().context("finish deflate stream")?;
    Ok(URL_SAFE_NO_PAD.encode(compressed))
}

/// Render the embed HTML for one project reference: an `<iframe>` into the
/// deployed `/book-example` route plus the optional caption.
#[must_use]
pub fn render_project_html(
    base_url: &str,
    attrs: &ProjectAttrs,
    caption: Option<&str>,
    payload: &str,
) -> String {
    let base = base_url.trim_end_matches('/');
    let url = format!("{base}/book-example#p={payload}");
    let mut out = String::from("<div class=\"rhizz-project\">");
    let _ = write!(
        out,
        "<iframe src=\"{url}\" width=\"100%\" height=\"{}\" style=\"border: 1px solid #ccc; border-radius: 8px;\" allowfullscreen loading=\"lazy\" title=\"Rhizz book example: {}\"></iframe>",
        attrs.height,
        crate::render::esc(&attrs.src)
    );
    if let Some(caption) = caption {
        let _ = write!(
            out,
            "<p class=\"rhizz-project-caption\">{}</p>",
            crate::render::esc(caption)
        );
    }
    out.push_str("</div>");
    out
}

#[cfg(test)]
mod tests {
    use super::{
        DEFAULT_PROJECT_HEIGHT, compile_project, encode_payload, load_project, parse_project_attrs,
        render_project_html,
    };
    use crate::project::ProjectAttrs;
    use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
    use flate2::read::ZlibDecoder;
    use serde_json::Value;
    use std::io::Read as _;

    /// Payload produced by the TypeScript codec (`JSON → CompressionStream
    /// deflate → base64url`) for two tiny files; proves the Rust encoder
    /// speaks the same format the `/book-example` route decodes.
    const TS_GOLDEN_PAYLOAD: &str = "eJxlzUEKwyAUBNCryKylpVshJ-nvQvS3EeI3qKQU8e5NIHXT7QzzpmHjXEISmJvGMyxcYO4Nq60zDMqnVI6X2S3QcEkqSx2xIniOiaAaiVKei8thrTumpqMjkHQSdD08H-wr21iu0Qb5Y7fA7314dD_0fJrG10k--hcAYT8M";

    fn write_project(dir: &std::path::Path) {
        std::fs::create_dir_all(dir.join("diagrams")).expect("mkdir diagrams");
        std::fs::write(
            dir.join("system.hcl"),
            "system \"demo\" {\n  description = \"d\"\n}\n",
        )
        .expect("write system.hcl");
        std::fs::write(
            dir.join("diagrams/main.hcl"),
            "view \"main\" {\n  system = \"demo\"\n}\n",
        )
        .expect("write main.hcl");
        // Non-HCL files and dotfiles are not part of the project.
        std::fs::write(dir.join("README.md"), "# demo\n").expect("write README");
        std::fs::write(dir.join(".hidden.hcl"), "junk").expect("write dotfile");
    }

    #[test]
    fn attrs_parse_full_form() {
        let attrs =
            parse_project_attrs("src=\"projects/demo\" height=\"600\"").expect("valid attrs");
        assert_eq!(attrs.src, "projects/demo");
        assert_eq!(attrs.height, 600);
    }

    #[test]
    fn attrs_default_height_and_bare_values() {
        let attrs = parse_project_attrs("src=projects/demo").expect("bare value");
        assert_eq!(attrs.src, "projects/demo");
        assert_eq!(attrs.height, DEFAULT_PROJECT_HEIGHT);
    }

    #[test]
    fn attrs_reject_missing_src_unknown_keys_and_bad_height() {
        assert!(parse_project_attrs("height=\"600\"").is_err());
        assert!(parse_project_attrs("src=\"\"").is_err());
        assert!(parse_project_attrs("src=\"a\" height=\"tall\"").is_err());
        assert!(parse_project_attrs("src=\"a\" height=\"0\"").is_err());
        assert!(parse_project_attrs("src=\"a\" foo=\"bar\"").is_err());
        assert!(parse_project_attrs("src").is_err());
        assert!(parse_project_attrs("src=\"a").is_err());
    }

    #[test]
    fn load_collects_hcl_sorted_and_ignores_non_hcl() {
        let dir = tempfile::TempDir::new().expect("tempdir");
        let proj = dir.path().join("projects/demo");
        write_project(&proj);
        let loaded = load_project(dir.path(), "projects/demo").expect("load");
        let paths: Vec<&str> = loaded.files.iter().map(|file| file.path.as_str()).collect();
        assert_eq!(paths, vec!["diagrams/main.hcl", "system.hcl"]);
        assert_eq!(loaded.files.len(), 2);
        assert!(!loaded.input_sha256.is_empty());
        for file in &loaded.files {
            assert_eq!(file.sha256.len(), 64);
        }
    }

    #[test]
    fn load_rejects_escape_missing_and_empty() {
        let dir = tempfile::TempDir::new().expect("tempdir");
        assert!(load_project(dir.path(), "../escape").is_err());
        assert!(load_project(dir.path(), "/abs").is_err());
        assert!(load_project(dir.path(), "nope").is_err());
        let empty = dir.path().join("empty");
        std::fs::create_dir_all(&empty).expect("mkdir empty");
        assert!(load_project(dir.path(), "empty").is_err());
    }

    #[test]
    fn compile_project_verdict_matches_web_sources() {
        let dir = tempfile::TempDir::new().expect("tempdir");
        let proj = dir.path().join("demo");
        write_project(&proj);
        let loaded = load_project(dir.path(), "demo").expect("load");
        let verdict = compile_project(&loaded.files);
        assert!(
            verdict.errors.is_empty(),
            "unexpected errors: {:?}",
            verdict.errors
        );
    }

    #[test]
    fn encode_is_url_safe_and_round_trips() {
        let dir = tempfile::TempDir::new().expect("tempdir");
        let proj = dir.path().join("demo");
        write_project(&proj);
        let loaded = load_project(dir.path(), "demo").expect("load");
        let payload = encode_payload(&loaded.files).expect("encode");
        assert!(
            payload
                .chars()
                .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_'),
            "payload must be base64url: {payload}"
        );
        let raw = URL_SAFE_NO_PAD
            .decode(&payload)
            .expect("decode own payload");
        let mut json = String::new();
        ZlibDecoder::new(&raw[..])
            .read_to_string(&mut json)
            .expect("inflate own payload");
        let value: Value = serde_json::from_str(&json).expect("payload is json");
        assert_eq!(value["version"], 1);
        assert_eq!(value["files"].as_array().map(Vec::len), Some(2));
        assert_eq!(value["files"][0]["path"], "diagrams/main.hcl");
    }

    #[test]
    fn decodes_typescript_generated_payload() {
        let raw = URL_SAFE_NO_PAD
            .decode(TS_GOLDEN_PAYLOAD)
            .expect("decode golden");
        let mut json = String::new();
        ZlibDecoder::new(&raw[..])
            .read_to_string(&mut json)
            .expect("inflate golden");
        let value: Value = serde_json::from_str(&json).expect("golden is json");
        assert_eq!(value["version"], 1);
        let files = value["files"].as_array().expect("files array");
        assert_eq!(files.len(), 2);
        assert_eq!(files[0]["path"], "system.hcl");
        assert!(
            files[0]["content"]
                .as_str()
                .is_some_and(|text| text.contains("system \"demo\""))
        );
    }

    #[test]
    fn render_embeds_url_height_and_escaped_caption() {
        let attrs = ProjectAttrs {
            src: "projects/demo".to_owned(),
            height: 600,
        };
        let html = render_project_html(
            "https://rhizz.fly.dev/",
            &attrs,
            Some("Caption <with> \"quotes\""),
            "PAYLOAD",
        );
        assert!(html.contains("<div class=\"rhizz-project\">"));
        assert!(html.contains("src=\"https://rhizz.fly.dev/book-example#p=PAYLOAD\""));
        assert!(html.contains("height=\"600\""));
        assert!(html.contains("loading=\"lazy\""));
        assert!(html.contains("Caption &lt;with&gt; &quot;quotes&quot;"));
    }

    #[test]
    fn render_omits_caption_paragraph_when_empty() {
        let attrs = ProjectAttrs {
            src: "projects/demo".to_owned(),
            height: DEFAULT_PROJECT_HEIGHT,
        };
        let html = render_project_html("https://rhizz.fly.dev", &attrs, None, "PAYLOAD");
        assert!(!html.contains("rhizz-project-caption"));
        assert!(html.contains("height=\"500\""));
    }
}
