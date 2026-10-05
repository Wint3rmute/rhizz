//! Filesystem persistence for the VFS API.
//!
//! The server is a dumb store: it persists exactly what the frontend dumps,
//! with no schema interpretation of its own (the frontend's zod validation
//! owns correctness). What it does *not* do is invent its own container
//! format — a project **is** a directory of ordinary files, so a data dir can
//! be a git checkout.
//!
//! # On-disk layout
//!
//! ```text
//! <data_dir>/
//!   drone/                     # one directory per project, named by its address
//!     system.hcl               # the model source (`main.hcl` works too)
//!     README.md                # any other file is carried through as-is
//!     views/main.hcl           # diagrams
//!     docs/battery.md          # per-component documentation
//! ```
//!
//! The directory name *is* the project's address, i.e. the slug of its name
//! (the frontend's `vfs/slug`), which is also what `/projects/<id>/…` is
//! addressed by. That keeps the frontend's invariant — an id is always
//! `projectSlug(name)` — true for projects discovered here as well as for
//! projects created in the UI.
//!
//! # What counts as a project
//!
//! A directory in the data dir is a project when its name is a valid address
//! *and* it contains at least one model source: a `.hcl` file that is not a
//! view source (`views/**`, or a legacy root-level `views.hcl` — the same
//! split `rhizz_core::is_view_source` draws). So `examples/` mounted as-is
//! yields its six project directories and ignores the `README.md` sitting
//! next to them.
//!
//! # What is deliberately not ours
//!
//! * **Hidden entries** (any name starting with `.`, at any depth) are skipped
//!   on read and left alone on write. That covers `.git`, `.DS_Store` and
//!   editor droppings in one rule, and it is why mounting a checkout does not
//!   walk into its `.git`.
//! * **Symlinks** are skipped: following one would serve (or overwrite) a file
//!   outside the data dir.
//! * **Directories that are not projects** are neither loaded nor deleted —
//!   "delete the projects missing from the payload" must not reach past the
//!   projects.
//! * **Unreadable entries** (binary files, permission errors) are logged and
//!   skipped rather than failing the whole data dir, matching the frontend's
//!   "start from what is usable" parsing.
//!
//! Data dir default is `rhizz-data` (relative to the server's cwd);
//! override with `RHIZZ_DATA_DIR`.

use std::collections::{HashMap, HashSet};
use std::ffi::OsStr;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{Context as _, Result};
use serde_json::{Value, json};
use thiserror::Error;

/// VFS blob version written into every response, mirroring the frontend's.
const VFS_VERSION: u64 = 1;

/// Suffix of the temporary file a content write goes through, so a crash
/// cannot leave a half-written file. The name is hidden (see module docs), so
/// a concurrent read never sees it.
const TEMP_SUFFIX: &str = ".tmp";

/// Milliseconds in a day, the unit the timestamp format works in.
const MILLIS_PER_DAY: i64 = 86_400_000;

/// The whole-VFS shape with empty project/node collections.
fn empty_vfs() -> Value {
    json!({
        "version": VFS_VERSION,
        "projects": [],
        "nodes": [],
    })
}

/// Whether `name` is hidden — a dotfile, or a dot-directory at any depth.
fn is_hidden(name: &str) -> bool {
    name.starts_with('.')
}

/// Whether `name` is a project address: the shape `projectSlug` produces
/// (lowercase ASCII alphanumerics in runs joined by single hyphens).
///
/// Enforced rather than normalized, so a project's directory name and its id
/// are always the same string — which is what lets a rename be a directory
/// rename and lets a payload's id be used as a path segment without ever
/// normalizing it first.
fn is_address(name: &str) -> bool {
    !name.is_empty()
        && name.split('-').all(|part| {
            !part.is_empty()
                && part
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
        })
}

/// Whether `name` is usable as one path segment of a node's name — no
/// separators, no `.`/`..`, no root, no empty.
fn is_path_segment(name: &str) -> bool {
    let mut components = Path::new(name).components();
    matches!(components.next(), Some(Component::Normal(_))) && components.next().is_none()
}

/// Whether `path` names an HCL file at all.
///
/// The model-source test is this *and* not a view: a project directory of
/// nothing but Markdown is a notes folder, not a system. (Mirrors the CLI's
/// own discovery in `rhizz-cli`'s `load_sources`, which collects `.hcl` plus
/// `docs/**.md` and nothing else.)
fn is_hcl_path(path: &Path) -> bool {
    path.extension().is_some_and(|ext| ext == "hcl")
}

/// Whether `path` names a view/diagram source, mirroring
/// `rhizz_core::is_view_source`: anything under a `views` directory, or a
/// root-level `views.hcl`.
fn is_view_path(path: &Path) -> bool {
    path.components().any(|c| c.as_os_str() == "views")
        || path.file_name().is_some_and(|name| name == "views.hcl")
}

/// The `parentId` for an entry at `prefix`, or `None` at the project root.
///
/// The root of a project has no parent *node* — its parent is the project
/// itself, which the node schema does not model.
fn parent_id_of(project_id: &str, prefix: &Path) -> Option<String> {
    (!prefix.as_os_str().is_empty()).then(|| node_id(project_id, prefix))
}

/// A node's id: its project address and project-relative path, `/`-separated
/// (e.g. `drone/views/main.hcl`).
///
/// The qualification is load-bearing, not decoration. The VFS blob is one
/// flat `nodes` array, and the frontend's store resolves a node *by id across
/// that whole array*: `findNode` takes the first match, and `updateFileContent`
/// rewrites every node whose id matches. Ids that are unique only within a
/// project therefore let a write to `drone/views/main.hcl` land on
/// `apollo-11/views/main.hcl` as well — which is exactly what happened before
/// the address was folded in. Deriving the id from the location keeps the
/// mapping stateless (a save never has to remember what it handed out) while
/// making it unique across the blob, which is the property the frontend
/// actually requires of an id.
fn node_id(project_id: &str, relative: &Path) -> String {
    let mut segments = vec![project_id.to_owned()];
    segments.extend(
        relative
            .components()
            .map(|c| c.as_os_str().to_string_lossy().into_owned()),
    );
    segments.join("/")
}

/// The project-relative part of an id built by [`node_id`].
///
/// The view/docs classifiers must see the path *inside* the project: a project
/// directory may itself be called `views`, and an id that starts `views/…`
/// would then make every one of its model sources look like a view source.
fn relative_of<'a>(project_id: &str, id: &'a str) -> &'a str {
    id.strip_prefix(project_id)
        .and_then(|rest| rest.strip_prefix('/'))
        .unwrap_or(id)
}

/// The file name of `entry` as a `String`, or `None` when it is not valid
/// UTF-8 (which no path this server produces ever is).
fn utf8_name(entry: &fs::DirEntry) -> Option<String> {
    entry.file_name().into_string().ok()
}

/// `dir`'s entries as `(name, entry)` pairs sorted by name.
///
/// Sorting is what makes a load deterministic: node order decides which file
/// the frontend treats as the primary source and which view a diagram page
/// opens first, neither of which may depend on `readdir` order.
fn sorted_entries(dir: &Path) -> Result<Vec<(String, fs::DirEntry)>, std::io::Error> {
    let mut entries: Vec<(String, fs::DirEntry)> = fs::read_dir(dir)?
        .filter_map(std::result::Result::ok)
        .filter_map(|entry| utf8_name(&entry).map(|name| (name, entry)))
        .collect();
    entries.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(entries)
}

/// Milliseconds from the Unix epoch to `time`, or `0` for a pre-epoch stamp.
fn millis_since_epoch(time: SystemTime) -> i64 {
    // A pre-epoch stamp is representable but outside anything meaningful, so
    // it clamps to the epoch rather than becoming a negative date.
    time.duration_since(UNIX_EPOCH).map_or(0, |delta| {
        i64::try_from(delta.as_millis()).unwrap_or(i64::MAX)
    })
}

/// Formats `millis` since the Unix epoch as RFC 3339, e.g.
/// `2023-11-14T22:13:20.123Z`.
///
/// Hand-rolled rather than pulled from a date crate: the VFS needs one string
/// shape, and the frontend parses it with `new Date(...)`. Every step
/// saturates rather than panicking, so a nonsensical stamp still yields a
/// string instead of taking the server down.
fn format_rfc3339_millis(millis: i64) -> String {
    let days = millis.div_euclid(MILLIS_PER_DAY);
    let time_of_day = millis.rem_euclid(MILLIS_PER_DAY);

    // Days-to-civil-date, after Howard Hinnant's `civil_from_days`: shift the
    // era so the leap day lands at the end of the year, then peel off the
    // century, year and month in turn.
    let shifted = days.saturating_add(719_468);
    let era = if shifted >= 0 {
        shifted / 146_097
    } else {
        shifted.saturating_sub(146_096) / 146_097
    };
    let day_of_era = shifted.saturating_sub(era.saturating_mul(146_097));
    let year_of_era = (day_of_era
        .saturating_sub(day_of_era / 1_460)
        .saturating_add(day_of_era / 36_524)
        .saturating_sub(day_of_era / 146_096))
        / 365;
    let mut year = year_of_era.saturating_add(era.saturating_mul(400));
    let day_of_year = day_of_era.saturating_sub(
        year_of_era
            .saturating_mul(365)
            .saturating_add(year_of_era / 4)
            .saturating_sub(year_of_era / 100),
    );
    let month_position = (day_of_year.saturating_mul(5).saturating_add(2)) / 153;
    let day = day_of_year
        .saturating_sub(month_position.saturating_mul(153).saturating_add(2) / 5)
        .saturating_add(1);
    let month = month_position.saturating_add(if month_position < 10 { 3 } else { -9 });
    if month <= 2 {
        year = year.saturating_add(1);
    }

    let hour = time_of_day / 3_600_000;
    let minute = (time_of_day % 3_600_000) / 60_000;
    let second = (time_of_day % 60_000) / 1_000;
    let milli = time_of_day % 1_000;

    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{milli:03}Z")
}

/// A node of a project's tree, as the loader found it on disk.
enum Found {
    /// A directory.
    Dir {
        /// The node's project-relative path.
        id: String,
        /// The parent's id, or `None` at the project root.
        parent_id: Option<String>,
        /// The entry's own name.
        name: String,
    },
    /// A file, with its content and the two fields derived from its mtime.
    File {
        /// The node's project-relative path.
        id: String,
        /// The parent's id, or `None` at the project root.
        parent_id: Option<String>,
        /// The entry's own name.
        name: String,
        /// The file's contents, read as UTF-8.
        content: String,
        /// Milliseconds since the epoch from the file's mtime, as a JSON-safe
        /// integer: a raw nanosecond count would not be (~1.8e18, past 2^53).
        revision: u64,
        /// The same instant as `revision`, as RFC 3339.
        updated_at: String,
    },
}

impl Found {
    /// The JSON node the frontend stores.
    fn to_json(&self, project_id: &str) -> Value {
        match self {
            Self::Dir {
                id,
                parent_id,
                name,
            } => json!({
                "id": id,
                "projectId": project_id,
                "parentId": parent_id,
                "name": name,
                "kind": "directory",
            }),
            Self::File {
                id,
                parent_id,
                name,
                content,
                revision,
                updated_at,
            } => json!({
                "id": id,
                "projectId": project_id,
                "parentId": parent_id,
                "name": name,
                "kind": "file",
                "content": content,
                "revision": revision,
                "updatedAt": updated_at,
            }),
        }
    }
}

/// Collects every entry under `dir`, depth-first in sorted order.
///
/// `prefix` is `dir`'s own project-relative path (empty at the project root)
/// and `stats` collects the oldest/newest file stamps seen, for the project's
/// own `createdAt`/`updatedAt`.
fn walk_project(
    project_id: &str,
    dir: &Path,
    prefix: &Path,
    found: &mut Vec<Found>,
    stats: &mut Option<(i64, i64)>,
) -> Result<(), std::io::Error> {
    for (name, entry) in sorted_entries(dir)? {
        if is_hidden(&name) {
            continue;
        }
        // `symlink_metadata` does not follow, so a symlink classifies as one
        // here and is dropped below rather than silently followed out of the
        // data dir.
        let Ok(metadata) = entry.path().symlink_metadata() else {
            continue;
        };
        if metadata.file_type().is_symlink() {
            continue;
        }
        let relative = prefix.join(&name);
        if metadata.is_dir() {
            let id = node_id(project_id, &relative);
            found.push(Found::Dir {
                id: id.clone(),
                parent_id: parent_id_of(project_id, prefix),
                name,
            });
            walk_project(project_id, &entry.path(), &relative, found, stats)?;
        } else if metadata.is_file() {
            let Ok(content) = fs::read_to_string(entry.path()) else {
                tracing::warn!(
                    path = %entry.path().display(),
                    "skipping unreadable VFS entry (not valid UTF-8?)"
                );
                continue;
            };
            let modified = metadata.modified().unwrap_or(UNIX_EPOCH);
            let millis = millis_since_epoch(modified);
            *stats = Some(match *stats {
                None => (millis, millis),
                Some((oldest, newest)) => (oldest.min(millis), newest.max(millis)),
            });
            found.push(Found::File {
                id: node_id(project_id, &relative),
                parent_id: parent_id_of(project_id, prefix),
                name,
                content,
                revision: u64::try_from(millis).unwrap_or(0),
                updated_at: format_rfc3339_millis(millis),
            });
        }
    }
    Ok(())
}

/// Whether a walked tree holds a model source, i.e. whether the directory it
/// came from is a project at all.
fn has_model_source(project_id: &str, found: &[Found]) -> bool {
    found.iter().any(|node| match node {
        Found::Dir { .. } => false,
        Found::File { id, .. } => {
            let path = Path::new(relative_of(project_id, id));
            is_hcl_path(path) && !is_view_path(path)
        }
    })
}

/// Reads one project directory, or `None` when it is not a project (no model
/// source inside).
fn read_project(
    project_id: &str,
    dir: &Path,
) -> Result<Option<(Value, Vec<Value>)>, std::io::Error> {
    let mut found = Vec::new();
    let mut stats = None;
    walk_project(project_id, dir, Path::new(""), &mut found, &mut stats)?;

    if !has_model_source(project_id, &found) {
        return Ok(None);
    }

    // A project always has at least one file (the model source that got it
    // here), so the stamps are always defined.
    let (oldest, newest) = stats.unwrap_or((0, 0));
    let project = json!({
        "id": project_id,
        // The directory name is the address, and an address is a slug — so the
        // display name is the slug. A prettier name would need a sidecar file
        // in every project directory, which would then show up in the user's
        // repository; not worth it for a label.
        "name": project_id,
        "createdAt": format_rfc3339_millis(oldest),
        "updatedAt": format_rfc3339_millis(newest),
    });
    let nodes = found.iter().map(|node| node.to_json(project_id)).collect();
    Ok(Some((project, nodes)))
}

/// Whether `dir` holds a model source, i.e. whether it is a project at all.
fn is_project_dir(project_id: &str, dir: &Path) -> bool {
    let mut found = Vec::new();
    let mut stats = None;
    walk_project(project_id, dir, Path::new(""), &mut found, &mut stats).is_ok()
        && has_model_source(project_id, &found)
}

/// Reads the data dir and expands it into the whole-VFS shape
/// `{ "version": 1, "projects": […], "nodes": […] }`, one entry per project
/// directory.
///
/// # Errors
///
/// Returns an error if the data dir itself cannot be listed. A project that
/// cannot be read is logged and skipped rather than failing the whole read.
pub fn load_vfs(data_dir: &Path) -> Result<Value> {
    let mut vfs = empty_vfs();
    if !data_dir.is_dir() {
        return Ok(vfs);
    }

    let mut projects: Vec<Value> = Vec::new();
    let mut nodes: Vec<Value> = Vec::new();
    for (name, entry) in sorted_entries(data_dir)
        .with_context(|| format!("cannot read data dir {}", data_dir.display()))?
    {
        if is_hidden(&name) || !is_address(&name) {
            continue;
        }
        let path = entry.path();
        // `symlink_metadata` so a symlinked directory is not descended into.
        let Ok(metadata) = path.symlink_metadata() else {
            continue;
        };
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            continue;
        }
        match read_project(&name, &path) {
            Ok(Some((project, project_nodes))) => {
                projects.push(project);
                nodes.extend(project_nodes);
            }
            Ok(None) => {}
            Err(err) => tracing::warn!(
                path = %path.display(),
                ?err,
                "skipping unreadable VFS project directory"
            ),
        }
    }

    if let Some(obj) = vfs.as_object_mut() {
        obj.insert("projects".to_owned(), Value::Array(projects));
        obj.insert("nodes".to_owned(), Value::Array(nodes));
    }
    Ok(vfs)
}

/// Error type for [`save_vfs`], letting the caller distinguish a malformed
/// payload (mapped to HTTP 400) from a filesystem failure (mapped to 500)
/// without downcasting through the `anyhow` context chain.
#[derive(Debug, Error)]
pub enum SaveVfsError {
    /// The payload does not match the whole-VFS shape, or names a path the
    /// server refuses to write.
    #[error("{0}")]
    Malformed(String),
    /// The data dir could not be read or written.
    #[error("{0}")]
    Io(#[from] std::io::Error),
}

/// What a project's directory should contain once the payload is applied.
enum Wanted {
    /// A directory at this project-relative path.
    Dir,
    /// A file at this project-relative path, with this content.
    File(String),
}

/// Resolves every node of `project_id` to the path it addresses inside its
/// project directory, validating as it goes.
///
/// Returns a `HashMap` rather than a `BTreeMap` because the caller sorts
/// before touching the filesystem; what matters here is that every path is
/// unique, which a map keyed by path gives for free.
type ProjectPlan = HashMap<PathBuf, Wanted>;

/// Resolves one node's project-relative path by walking its parent chain.
///
/// `chain` guards against a payload whose parents form a loop: the walk is
/// bounded by the node count, so a malformed payload cannot hang the server.
fn resolve_path(
    id: &str,
    nodes: &HashMap<&str, &Value>,
    chain: &mut Vec<String>,
) -> Result<PathBuf, SaveVfsError> {
    if chain.iter().any(|seen| seen == id) {
        return Err(SaveVfsError::Malformed(format!(
            "node `{id}` is its own ancestor"
        )));
    }
    let Some(node) = nodes.get(id) else {
        return Err(SaveVfsError::Malformed(format!(
            "node `{id}` is referenced as a parent but is not in the payload"
        )));
    };
    let name = node
        .get("name")
        .and_then(Value::as_str)
        .ok_or_else(|| SaveVfsError::Malformed(format!("node `{id}` has no name")))?;
    if !is_path_segment(name) {
        return Err(SaveVfsError::Malformed(format!(
            "node name {name:?} is not a plain file name"
        )));
    }

    chain.push(id.to_owned());
    let resolved = match node.get("parentId") {
        None | Some(Value::Null) => Ok(PathBuf::from(name)),
        Some(Value::String(parent_id)) => {
            let parent = nodes.get(parent_id.as_str()).ok_or_else(|| {
                SaveVfsError::Malformed(format!("node `{id}` has an unknown parent"))
            })?;
            if parent.get("kind").and_then(Value::as_str) != Some("directory") {
                return Err(SaveVfsError::Malformed(format!(
                    "node `{id}` is nested under `{parent_id}`, which is not a directory"
                )));
            }
            resolve_path(parent_id, nodes, chain).map(|parent| parent.join(name))
        }
        Some(_) => Err(SaveVfsError::Malformed(format!(
            "node `{id}` has a malformed parentId"
        ))),
    };
    chain.pop();
    resolved
}

/// Reads the payload's projects and turns each one's nodes into the tree its
/// directory should hold.
///
/// Rejects anything the server would have to trust to build a path: an
/// address-shaped project id (which is also what keeps `..` out of a path
/// segment), plain file names, and parent chains that dangle, cross projects,
/// loop, or resolve to the same path twice.
fn plan(payload: &Value) -> Result<Vec<(String, ProjectPlan)>, SaveVfsError> {
    let obj = payload
        .as_object()
        .ok_or_else(|| SaveVfsError::Malformed("payload must be a JSON object".to_owned()))?;
    let Some(projects) = obj.get("projects").and_then(Value::as_array) else {
        return Err(SaveVfsError::Malformed(
            "payload must have a `projects` array".to_owned(),
        ));
    };
    let nodes = obj
        .get("nodes")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let mut ids: HashSet<&str> = HashSet::new();
    for project in projects {
        let id = project.get("id").and_then(Value::as_str).ok_or_else(|| {
            SaveVfsError::Malformed("every project must have a string `id`".to_owned())
        })?;
        if !is_address(id) {
            return Err(SaveVfsError::Malformed(format!(
                "project id {id:?} is not a valid project address"
            )));
        }
        if !ids.insert(id) {
            return Err(SaveVfsError::Malformed(format!(
                "duplicate project id `{id}`"
            )));
        }
    }

    let mut by_project: HashMap<&str, HashMap<&str, &Value>> = HashMap::new();
    for node in &nodes {
        let project_id = node
            .get("projectId")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                SaveVfsError::Malformed("every node must have a string `projectId`".to_owned())
            })?;
        if !ids.contains(project_id) {
            return Err(SaveVfsError::Malformed(format!(
                "node belongs to unknown project `{project_id}`"
            )));
        }
        by_project.entry(project_id).or_default().insert(
            node.get("id").and_then(Value::as_str).ok_or_else(|| {
                SaveVfsError::Malformed("every node must have a string `id`".to_owned())
            })?,
            node,
        );
    }

    let mut plans = Vec::new();
    for project in projects {
        // Validated as an address above, so it is a single safe segment.
        let id = project
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(|| SaveVfsError::Malformed("project id must be a string".to_owned()))?;
        let empty = HashMap::new();
        let project_nodes = by_project.get(id).unwrap_or(&empty);

        let mut plan: ProjectPlan = HashMap::new();
        // Sorted so a collision is reported the same way every time.
        let mut ordered: Vec<(&str, &Value)> =
            project_nodes.iter().map(|(k, v)| (*k, *v)).collect();
        ordered.sort_by(|a, b| a.0.cmp(b.0));
        for (node_id, node) in ordered {
            let mut chain = Vec::new();
            let path = resolve_path(node_id, project_nodes, &mut chain)?;
            let wanted = match node.get("kind").and_then(Value::as_str) {
                Some("directory") => Wanted::Dir,
                Some("file") => Wanted::File(
                    node.get("content")
                        .and_then(Value::as_str)
                        .ok_or_else(|| {
                            SaveVfsError::Malformed(format!("file `{node_id}` has no content"))
                        })?
                        .to_owned(),
                ),
                _ => {
                    return Err(SaveVfsError::Malformed(format!(
                        "node `{node_id}` has no `kind`"
                    )));
                }
            };
            if plan.insert(path.clone(), wanted).is_some() {
                return Err(SaveVfsError::Malformed(format!(
                    "two nodes resolve to the same path `{}`",
                    path.display()
                )));
            }
        }
        plans.push((id.to_owned(), plan));
    }
    Ok(plans)
}

/// The entries physically under `root`, deepest first, as
/// `(relative path, is_dir)`.
fn disk_entries(root: &Path) -> Vec<(PathBuf, bool)> {
    fn walk(dir: &Path, prefix: &Path, out: &mut Vec<(PathBuf, bool)>) {
        let Ok(entries) = sorted_entries(dir) else {
            return;
        };
        for (name, entry) in entries {
            if is_hidden(&name) {
                continue;
            }
            let Ok(metadata) = entry.path().symlink_metadata() else {
                continue;
            };
            if metadata.file_type().is_symlink() {
                continue;
            }
            let relative = prefix.join(&name);
            if metadata.is_dir() {
                walk(&entry.path(), &relative, out);
                out.push((relative, true));
            } else if metadata.is_file() {
                out.push((relative, false));
            }
        }
    }
    let mut out = Vec::new();
    walk(root, Path::new(""), &mut out);
    // Deepest first, so a removed directory's children are already gone.
    out.sort_by_key(|(path, is_dir)| (path.components().count(), !*is_dir));
    out.reverse();
    out
}

/// Writes `content` to `path` through a hidden temp file, so a crash cannot
/// leave a half-written file where a valid one used to be.
fn write_atomic(path: &Path, content: &str) -> Result<(), SaveVfsError> {
    let name = path
        .file_name()
        .and_then(OsStr::to_str)
        .ok_or_else(|| SaveVfsError::Malformed(format!("cannot write to {}", path.display())))?;
    let temp = path.with_file_name(format!(".{name}{TEMP_SUFFIX}"));
    fs::write(&temp, content)?;
    if let Err(err) = fs::rename(&temp, path) {
        // The rename is the only step that can fail after the content is on
        // disk; do not leave the temp file behind.
        let _ = fs::remove_file(&temp);
        return Err(SaveVfsError::Io(err));
    }
    Ok(())
}

/// Makes `root` hold exactly the `plan` tree.
///
/// Removal comes first, and treats a *type* mismatch as stale too, so a file
/// that became a directory (or the reverse) is replaced instead of colliding.
fn apply_plan(root: &Path, plan: &ProjectPlan) -> Result<(), SaveVfsError> {
    fs::create_dir_all(root)?;

    for (relative, is_dir) in disk_entries(root) {
        let stale = match plan.get(&relative) {
            None => true,
            Some(Wanted::Dir) => !is_dir,
            Some(Wanted::File(_)) => is_dir,
        };
        if !stale {
            continue;
        }
        let path = root.join(&relative);
        if is_dir {
            fs::remove_dir_all(&path)?;
        } else {
            fs::remove_file(&path)?;
        }
    }

    // Directories first: `create_dir_all` would make the file writes work
    // anyway, but doing it this way keeps a half-made tree from existing for
    // longer than it has to.
    for (relative, entry) in plan {
        if matches!(entry, Wanted::Dir) {
            fs::create_dir_all(root.join(relative))?;
        }
    }
    for (relative, entry) in plan {
        let Wanted::File(content) = entry else {
            continue;
        };
        let path = root.join(relative);
        // Skip the write when the content already matches: re-serializing an
        // unchanged file would bump its mtime, and with it the project's
        // `updatedAt`, on every save — including the ones the frontend's
        // debounced writers fire while nothing changed.
        if fs::read_to_string(&path).is_ok_and(|current| current == *content) {
            continue;
        }
        write_atomic(&path, content)?;
    }
    Ok(())
}

/// Persists a whole-VFS payload as one directory tree per project.
///
/// The payload is authoritative, as it always has been: every project in it
/// has its directory brought to exactly the described state, and project
/// directories that are absent from it are deleted. Anything that is not a
/// project — hidden entries, files, symlinks, directories without a model
/// source — is left untouched.
///
/// Writes go through a temp file + rename so a crash cannot leave a
/// half-written file.
///
/// # Errors
///
/// Returns [`SaveVfsError::Malformed`] for payloads that do not describe a
/// writable tree (the caller maps it to 400) or [`SaveVfsError::Io`] when the
/// filesystem refuses (maps to 500).
pub fn save_vfs(data_dir: &Path, payload: &Value) -> Result<(), SaveVfsError> {
    let plans = plan(payload)?;
    let ids: HashSet<&str> = plans.iter().map(|(id, _)| id.as_str()).collect();

    fs::create_dir_all(data_dir)?;
    for (id, project_plan) in &plans {
        apply_plan(&data_dir.join(id), project_plan)?;
    }

    // Delete the project directories the payload no longer mentions. Only
    // real projects are considered, so a stray directory in the data dir is
    // not the server's to delete.
    let existing = fs::read_dir(data_dir)?;
    for entry in existing {
        let entry = entry?;
        let Some(name) = utf8_name(&entry) else {
            continue;
        };
        if is_hidden(&name) || !is_address(&name) || ids.contains(name.as_str()) {
            continue;
        }
        let path = entry.path();
        let Ok(metadata) = path.symlink_metadata() else {
            continue;
        };
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            continue;
        }
        if is_project_dir(&name, &path) {
            fs::remove_dir_all(&path)?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // ── Fixtures ───────────────────────────────────────────────────────

    /// Writes `content` to `path`, creating parent directories as needed.
    fn write_file(path: &Path, content: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, content).unwrap();
    }

    /// Lays out one example-style project directory and returns the tempdir.
    fn data_dir_with_drone() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        write_file(
            &dir.path().join("drone/system.hcl"),
            "system \"quadcopter\" {}\n",
        );
        write_file(
            &dir.path().join("drone/views/main.hcl"),
            "view \"main\" {}\n",
        );
        dir
    }

    /// The node with `id`, panicking with a readable message when absent.
    ///
    /// Deliberately reports only the id and the ids it *did* find: a whole
    /// project blob is tens of kilobytes of HCL, and a failure message made of
    /// that is unreadable.
    fn node<'a>(vfs: &'a Value, id: &str) -> &'a Value {
        let nodes = vfs["nodes"].as_array().unwrap();
        nodes
            .iter()
            .find(|n| n["id"] == json!(id))
            .unwrap_or_else(|| {
                let found: Vec<&str> = nodes.iter().filter_map(|n| n["id"].as_str()).collect();
                panic!("no node with id {id:?}; found {found:?}")
            })
    }

    /// The id the loader hands out for `path` inside `project`.
    fn id_of(project: &str, path: &str) -> String {
        format!("{project}/{path}")
    }

    /// Every node id, in the order the blob lists them.
    fn node_ids(vfs: &Value) -> Vec<String> {
        vfs["nodes"]
            .as_array()
            .unwrap()
            .iter()
            .map(|n| n["id"].as_str().unwrap().to_owned())
            .collect()
    }

    /// Every project id, in the order the blob lists them.
    fn project_ids(vfs: &Value) -> Vec<String> {
        vfs["projects"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| p["id"].as_str().unwrap().to_owned())
            .collect()
    }

    /// A file's stored content.
    fn content_of(vfs: &Value, id: &str) -> String {
        node(vfs, id)["content"].as_str().unwrap().to_owned()
    }

    /// A path's mtime as milliseconds since the Unix epoch — the value the
    /// loader is expected to derive `revision`/`updatedAt` from.
    fn mtime_millis(path: &Path) -> i64 {
        let modified = fs::metadata(path).unwrap().modified().unwrap();
        i64::try_from(modified.duration_since(UNIX_EPOCH).unwrap().as_millis()).unwrap()
    }

    /// Whether `path` holds no entries at all.
    fn dir_is_empty(path: &Path) -> bool {
        fs::read_dir(path).map_or(true, |mut e| e.next().is_none())
    }

    // ── Payload builders ───────────────────────────────────────────────

    fn project(id: &str) -> Value {
        json!({ "id": id, "name": id, "createdAt": "t0", "updatedAt": "t1" })
    }

    fn file_node(
        id: &str,
        project: &str,
        parent: Option<&str>,
        name: &str,
        content: &str,
    ) -> Value {
        json!({
            "id": id, "projectId": project, "parentId": parent, "name": name,
            "kind": "file", "content": content, "revision": 1, "updatedAt": "t2"
        })
    }

    fn dir_node(id: &str, project: &str, parent: Option<&str>, name: &str) -> Value {
        json!({
            "id": id, "projectId": project, "parentId": parent, "name": name,
            "kind": "directory"
        })
    }

    /// A whole-VFS payload from projects and nodes.
    fn vfs(projects: &[Value], nodes: &[Value]) -> Value {
        json!({ "version": 1, "projects": projects, "nodes": nodes })
    }

    // ── Loading: discovery ─────────────────────────────────────────────

    #[test]
    fn load_yields_empty_vfs_for_a_missing_or_empty_dir() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("does-not-exist");
        for path in [&missing, dir.path()] {
            assert_eq!(load_vfs(path).unwrap(), empty_vfs());
        }
    }

    #[test]
    fn load_reads_a_project_directory_into_a_node_tree() {
        let dir = tempfile::tempdir().unwrap();
        write_file(
            &dir.path().join("drone/system.hcl"),
            "system \"quadcopter\" {}\n",
        );
        write_file(
            &dir.path().join("drone/views/main.hcl"),
            "view \"main\" {}\n",
        );
        write_file(&dir.path().join("drone/docs/battery.md"), "# battery\n");
        write_file(&dir.path().join("drone/README.md"), "readme\n");

        let loaded = load_vfs(dir.path()).unwrap();

        assert_eq!(project_ids(&loaded), vec!["drone"]);
        // Every entry in the directory becomes a node, addressed by its
        // project-relative path — including the README, which is just a file.
        let mut ids = node_ids(&loaded);
        ids.sort();
        assert_eq!(
            ids,
            vec![
                "drone/README.md",
                "drone/docs",
                "drone/docs/battery.md",
                "drone/system.hcl",
                "drone/views",
                "drone/views/main.hcl",
            ]
        );
        let at = |path: &str| id_of("drone", path);
        assert_eq!(
            content_of(&loaded, &at("system.hcl")),
            "system \"quadcopter\" {}\n"
        );
        assert_eq!(
            content_of(&loaded, &at("views/main.hcl")),
            "view \"main\" {}\n"
        );
        assert_eq!(content_of(&loaded, &at("docs/battery.md")), "# battery\n");
        assert_eq!(content_of(&loaded, &at("README.md")), "readme\n");
        assert_eq!(node(&loaded, &at("views"))["kind"], json!("directory"));
        assert_eq!(node(&loaded, &at("system.hcl"))["kind"], json!("file"));
        // A root entry has no parent node — its parent is the project itself,
        // which the node schema does not model.
        assert_eq!(node(&loaded, &at("system.hcl"))["parentId"], json!(null));
        assert_eq!(
            node(&loaded, &at("views/main.hcl"))["parentId"],
            json!(at("views"))
        );
    }

    #[test]
    fn load_names_the_project_after_its_directory() {
        let dir = data_dir_with_drone();
        let loaded = load_vfs(dir.path()).unwrap();
        let project = &loaded["projects"][0];
        assert_eq!(project["id"], json!("drone"));
        assert_eq!(project["name"], json!("drone"));
    }

    #[test]
    fn load_derives_revision_and_updated_at_from_the_file_mtime() {
        let dir = data_dir_with_drone();
        let path = dir.path().join("drone/system.hcl");
        let expected = mtime_millis(&path);

        let loaded = load_vfs(dir.path()).unwrap();

        let file = node(&loaded, &id_of("drone", "system.hcl"));
        assert_eq!(file["revision"], json!(u64::try_from(expected).unwrap()));
        assert_eq!(file["updatedAt"], json!(format_rfc3339_millis(expected)));
    }

    #[test]
    fn load_spans_project_timestamps_over_the_oldest_and_newest_file() {
        let dir = data_dir_with_drone();
        let oldest = mtime_millis(&dir.path().join("drone/system.hcl"));
        let newest = mtime_millis(&dir.path().join("drone/views/main.hcl"));
        let (created, updated) = if oldest <= newest {
            (oldest, newest)
        } else {
            (newest, oldest)
        };

        let loaded = load_vfs(dir.path()).unwrap();

        let project = &loaded["projects"][0];
        assert_eq!(project["createdAt"], json!(format_rfc3339_millis(created)));
        assert_eq!(project["updatedAt"], json!(format_rfc3339_millis(updated)));
    }

    #[test]
    fn load_sorts_projects_by_address() {
        let dir = tempfile::tempdir().unwrap();
        for address in ["zulu", "alpha", "mike"] {
            write_file(
                &dir.path().join(address).join("system.hcl"),
                "system \"s\" {}\n",
            );
        }

        assert_eq!(
            project_ids(&load_vfs(dir.path()).unwrap()),
            vec!["alpha", "mike", "zulu"]
        );
    }

    #[test]
    fn load_sorts_a_projects_nodes_by_path() {
        // Node order decides which file the compiler treats as the primary
        // source and which view a diagram page opens first, so it has to come
        // from the filesystem in a stable order rather than from readdir's.
        let dir = tempfile::tempdir().unwrap();
        for path in [
            "zzz.hcl",
            "aaa.hcl",
            "views/main.hcl",
            "views/aaa.hcl",
            "docs/battery.md",
            "mmm.hcl",
        ] {
            write_file(&dir.path().join("drone").join(path), "x\n");
        }

        assert_eq!(
            node_ids(&load_vfs(dir.path()).unwrap()),
            vec![
                "drone/aaa.hcl",
                "drone/docs",
                "drone/docs/battery.md",
                "drone/mmm.hcl",
                "drone/views",
                "drone/views/aaa.hcl",
                "drone/views/main.hcl",
                "drone/zzz.hcl",
            ]
        );
    }

    #[test]
    fn load_ignores_entries_that_are_not_projects() {
        let dir = tempfile::tempdir().unwrap();
        // A file at the data-dir root is not a project.
        write_file(&dir.path().join("README.md"), "readme\n");
        // Neither is a directory without a model source: no `.hcl` at all…
        fs::create_dir_all(dir.path().join("notes")).unwrap();
        write_file(&dir.path().join("notes/scratch.md"), "# scratch\n");
        // …or `.hcl` files that are all view sources.
        write_file(
            &dir.path().join("gallery/views/main.hcl"),
            "view \"main\" {}\n",
        );
        write_file(&dir.path().join("empty/.keep"), "");

        let loaded = load_vfs(dir.path()).unwrap();

        assert_eq!(loaded, empty_vfs());
    }

    #[test]
    fn load_ignores_hidden_entries_at_every_level() {
        let dir = data_dir_with_drone();
        write_file(&dir.path().join(".git/config"), "[core]\n");
        write_file(&dir.path().join("drone/.hidden.hcl"), "system \"x\" {}\n");
        write_file(&dir.path().join("drone/.DS_Store"), "junk");
        write_file(&dir.path().join("drone/views/.gitkeep"), "");

        let loaded = load_vfs(dir.path()).unwrap();

        assert_eq!(project_ids(&loaded), vec!["drone"]);
        assert_eq!(
            node_ids(&loaded),
            vec!["drone/system.hcl", "drone/views", "drone/views/main.hcl"]
        );
    }

    #[test]
    fn load_ignores_a_hidden_project_directory() {
        let dir = data_dir_with_drone();
        write_file(&dir.path().join(".rhizz/system.hcl"), "system \"x\" {}\n");

        assert_eq!(project_ids(&load_vfs(dir.path()).unwrap()), vec!["drone"]);
    }

    #[test]
    fn load_ignores_symlinks() {
        let dir = data_dir_with_drone();
        let outside = dir.path().join("outside.hcl");
        write_file(&outside, "system \"leaked\" {}\n");
        std::os::unix::fs::symlink(&outside, dir.path().join("drone/linked.hcl")).unwrap();

        let loaded = load_vfs(dir.path()).unwrap();

        assert!(!node_ids(&loaded).contains(&"linked.hcl".to_owned()));
    }

    #[test]
    fn load_ignores_directories_whose_name_is_not_its_own_address() {
        let dir = data_dir_with_drone();
        write_file(
            &dir.path().join("Drone System/system.hcl"),
            "system \"x\" {}\n",
        );

        assert_eq!(project_ids(&load_vfs(dir.path()).unwrap()), vec!["drone"]);
    }

    #[test]
    fn load_accepts_main_hcl_as_the_model_source() {
        let dir = tempfile::tempdir().unwrap();
        write_file(&dir.path().join("scratch/main.hcl"), "system \"s\" {}\n");

        let loaded = load_vfs(dir.path()).unwrap();

        assert_eq!(project_ids(&loaded), vec!["scratch"]);
        assert_eq!(
            content_of(&loaded, &id_of("scratch", "main.hcl")),
            "system \"s\" {}\n"
        );
    }

    #[test]
    fn load_reads_every_example_project() {
        // The end goal of the layout: a checkout's `examples/` directory is a
        // valid data dir, so mounting it lists the examples as projects.
        let examples = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples");
        if !examples.is_dir() {
            return; // examples/ is not part of a published crate
        }

        let loaded = load_vfs(&examples).unwrap();

        let mut ids = project_ids(&loaded);
        ids.sort();
        assert_eq!(
            ids,
            vec![
                "apollo-11",
                "drone",
                "single-file",
                "social-media",
                "software-house",
                "web-app",
            ]
        );
        // Ids carry the project address, so every example's model source is a
        // distinct node and no two nodes in the blob share an id.
        assert!(content_of(&loaded, &id_of("drone", "system.hcl")).contains("system "));
        let node_list = node_ids(&loaded);
        assert_eq!(
            node_list
                .iter()
                .filter(|id| *id == "drone/system.hcl")
                .count(),
            1,
            "{node_list:?}"
        );
        assert!(node_list.contains(&"apollo-11/views/main.hcl".to_owned()));
        assert!(node_list.contains(&"software-house/docs/product.md".to_owned()));
    }

    #[test]
    fn node_ids_are_unique_across_the_whole_blob() {
        // The regression guard for the cross-project wipe: the frontend's store
        // resolves a node by id across the entire flat `nodes` array
        // (`findNode` takes the first match, `updateFileContent` rewrites every
        // match), so an id that is unique only *within* a project lets a write
        // to one project land on another. Ids must therefore be unique over the
        // blob, which for a real filesystem means carrying the project address.
        let dir = tempfile::tempdir().unwrap();
        // Two projects with byte-identical layouts: every path collides if the
        // id does not include the address.
        for project in ["drone", "web-app"] {
            write_file(
                &dir.path().join(project).join("system.hcl"),
                "system \"s\" {}\n",
            );
            write_file(
                &dir.path().join(project).join("views/main.hcl"),
                "view \"main\" {}\n",
            );
            write_file(&dir.path().join(project).join("docs/battery.md"), "# b\n");
        }

        let loaded = load_vfs(dir.path()).unwrap();

        let ids = node_ids(&loaded);
        let mut deduped = ids.clone();
        deduped.sort();
        deduped.dedup();
        assert_eq!(
            ids.len(),
            deduped.len(),
            "ids must be unique across projects: {ids:?}"
        );
        // …and they name the project they belong to.
        for id in &ids {
            assert!(
                id.starts_with("drone/") || id.starts_with("web-app/"),
                "id {id:?} carries no project address"
            );
        }
        // system.hcl + views/ + views/main.hcl + docs/ + docs/battery.md
        assert_eq!(ids.len(), 10, "five entries per project: {ids:?}");
    }

    #[test]
    fn a_project_directory_named_views_is_still_a_project() {
        // The view classifier has to see the path *inside* the project: an id
        // that starts with `views/` must not make the project's own model
        // source look like a view source.
        let dir = tempfile::tempdir().unwrap();
        write_file(&dir.path().join("views/system.hcl"), "system \"s\" {}\n");
        write_file(
            &dir.path().join("views/views/inner.hcl"),
            "view \"inner\" {}\n",
        );

        let loaded = load_vfs(dir.path()).unwrap();

        assert_eq!(project_ids(&loaded), vec!["views"]);
        assert_eq!(
            node_ids(&loaded),
            vec!["views/system.hcl", "views/views", "views/views/inner.hcl"]
        );
    }

    // ── Timestamp formatting ───────────────────────────────────────────

    #[test]
    fn formats_known_instants_as_rfc3339() {
        assert_eq!(format_rfc3339_millis(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(format_rfc3339_millis(1_000), "1970-01-01T00:00:01.000Z");
        // A leap day, and an instant past the 32-bit boundary.
        assert_eq!(
            format_rfc3339_millis(951_782_400_000),
            "2000-02-29T00:00:00.000Z"
        );
        assert_eq!(
            format_rfc3339_millis(1_700_000_000_123),
            "2023-11-14T22:13:20.123Z"
        );
    }

    #[test]
    fn formats_instants_before_the_epoch() {
        // Floor division, not truncation: a file stamped one millisecond
        // before 1970 belongs to the *previous* day, not to 1970.
        assert_eq!(format_rfc3339_millis(-1), "1969-12-31T23:59:59.999Z");
        assert_eq!(
            format_rfc3339_millis(-86_400_000),
            "1969-12-31T00:00:00.000Z"
        );
    }

    // ── Saving ─────────────────────────────────────────────────────────

    #[test]
    fn save_writes_a_project_into_a_directory_tree() {
        let dir = tempfile::tempdir().unwrap();
        let payload = vfs(
            &[project("drone")],
            &[
                dir_node("views", "drone", None, "views"),
                file_node(
                    "system.hcl",
                    "drone",
                    None,
                    "system.hcl",
                    "system \"s\" {}\n",
                ),
                file_node(
                    "views/main.hcl",
                    "drone",
                    Some("views"),
                    "main.hcl",
                    "view \"main\" {}\n",
                ),
            ],
        );

        save_vfs(dir.path(), &payload).unwrap();

        assert_eq!(
            fs::read_to_string(dir.path().join("drone/system.hcl")).unwrap(),
            "system \"s\" {}\n"
        );
        assert_eq!(
            fs::read_to_string(dir.path().join("drone/views/main.hcl")).unwrap(),
            "view \"main\" {}\n"
        );
        assert!(dir.path().join("drone/views").is_dir());
    }

    #[test]
    fn save_round_trips_a_directory_tree() {
        let dir = data_dir_with_drone();
        let before = load_vfs(dir.path()).unwrap();

        // Hand the loaded blob straight back, as the frontend does.
        save_vfs(dir.path(), &before).unwrap();

        let after = load_vfs(dir.path()).unwrap();
        assert_eq!(project_ids(&after), project_ids(&before));
        assert_eq!(node_ids(&after), node_ids(&before));
        for id in node_ids(&before) {
            if node(&before, &id)["kind"] == json!("file") {
                assert_eq!(content_of(&after, &id), content_of(&before, &id), "{id}");
            }
        }
    }

    #[test]
    fn save_creates_missing_parent_directories() {
        let dir = tempfile::tempdir().unwrap();
        let payload = vfs(
            &[project("p")],
            &[
                dir_node("a", "p", None, "a"),
                dir_node("b", "p", Some("a"), "b"),
                file_node("c", "p", Some("b"), "deep.hcl", "# deep\n"),
            ],
        );

        save_vfs(dir.path(), &payload).unwrap();

        assert_eq!(
            fs::read_to_string(dir.path().join("p/a/b/deep.hcl")).unwrap(),
            "# deep\n"
        );
    }

    #[test]
    fn save_deletes_files_the_payload_dropped() {
        let dir = data_dir_with_drone();

        let trimmed = vfs(
            &[project("drone")],
            &[file_node(
                "system.hcl",
                "drone",
                None,
                "system.hcl",
                "system \"q\" {}\n",
            )],
        );
        save_vfs(dir.path(), &trimmed).unwrap();

        assert!(!dir.path().join("drone/views/main.hcl").exists());
        assert!(!dir.path().join("drone/views").exists());
        assert_eq!(
            content_of(
                &load_vfs(dir.path()).unwrap(),
                &id_of("drone", "system.hcl")
            ),
            trimmed["nodes"][0]["content"]
        );
    }

    #[test]
    fn save_removes_project_directories_absent_from_the_payload() {
        let dir = data_dir_with_drone();
        write_file(&dir.path().join("zulu/system.hcl"), "system \"z\" {}\n");

        save_vfs(dir.path(), &vfs(&[project("drone")], &[])).unwrap();

        assert!(dir.path().join("drone").is_dir());
        assert!(!dir.path().join("zulu").exists());
    }

    #[test]
    fn save_keeps_directories_that_are_not_projects() {
        let dir = data_dir_with_drone();
        write_file(&dir.path().join("notes/scratch.md"), "# scratch\n");
        write_file(&dir.path().join("README.md"), "readme\n");

        save_vfs(dir.path(), &load_vfs(dir.path()).unwrap()).unwrap();

        // Deleting "projects absent from the payload" must not reach past the
        // projects: anything that isn't one is none of the server's business.
        assert!(dir.path().join("notes/scratch.md").exists());
        assert!(dir.path().join("README.md").exists());
    }

    #[test]
    fn save_leaves_hidden_entries_alone() {
        let dir = data_dir_with_drone();
        write_file(&dir.path().join(".git/config"), "[core]\n");
        write_file(&dir.path().join("drone/.DS_Store"), "junk");

        save_vfs(dir.path(), &load_vfs(dir.path()).unwrap()).unwrap();

        assert!(dir.path().join(".git/config").exists());
        assert!(dir.path().join("drone/.DS_Store").exists());
    }

    #[test]
    fn save_skips_files_whose_content_is_unchanged() {
        let dir = data_dir_with_drone();
        let payload = load_vfs(dir.path()).unwrap();
        let before = mtime_millis(&dir.path().join("drone/system.hcl"));

        save_vfs(dir.path(), &payload).unwrap();
        save_vfs(dir.path(), &payload).unwrap();

        assert_eq!(mtime_millis(&dir.path().join("drone/system.hcl")), before);
    }

    #[test]
    fn save_writes_a_file_whose_content_changed() {
        let dir = data_dir_with_drone();
        let payload = vfs(
            &[project("drone")],
            &[file_node(
                "system.hcl",
                "drone",
                None,
                "system.hcl",
                "system \"new\" {}\n",
            )],
        );

        save_vfs(dir.path(), &payload).unwrap();

        assert_eq!(
            fs::read_to_string(dir.path().join("drone/system.hcl")).unwrap(),
            "system \"new\" {}\n"
        );
    }

    #[test]
    fn save_replaces_a_file_with_a_directory_of_the_same_name() {
        let dir = data_dir_with_drone();

        save_vfs(
            dir.path(),
            &vfs(
                &[project("drone")],
                &[
                    file_node(
                        "system.hcl",
                        "drone",
                        None,
                        "system.hcl",
                        "system \"s\" {}\n",
                    ),
                    dir_node("views", "drone", None, "views"),
                    file_node(
                        "views/main.hcl",
                        "drone",
                        Some("views"),
                        "main.hcl",
                        "view \"m\" {}\n",
                    ),
                ],
            ),
        )
        .unwrap();

        assert!(dir.path().join("drone/views").is_dir());
        assert_eq!(
            node_ids(&load_vfs(dir.path()).unwrap()),
            vec!["drone/system.hcl", "drone/views", "drone/views/main.hcl"]
        );
    }

    #[test]
    fn save_replaces_a_directory_with_a_file_of_the_same_name() {
        let dir = data_dir_with_drone();

        save_vfs(
            dir.path(),
            &vfs(
                &[project("drone")],
                &[
                    file_node(
                        "system.hcl",
                        "drone",
                        None,
                        "system.hcl",
                        "system \"s\" {}\n",
                    ),
                    file_node("views", "drone", None, "views", "not a directory\n"),
                ],
            ),
        )
        .unwrap();

        assert!(dir.path().join("drone/views").is_file());
        assert_eq!(
            node_ids(&load_vfs(dir.path()).unwrap()),
            vec!["drone/system.hcl", "drone/views"]
        );
    }

    // ── Saving: what the server refuses ─────────────────────────────────

    #[test]
    fn save_rejects_payload_without_projects() {
        let dir = tempfile::tempdir().unwrap();
        assert!(save_vfs(dir.path(), &json!({ "version": 1, "nodes": [] })).is_err());
    }

    #[test]
    fn save_rejects_a_non_object_payload() {
        let dir = tempfile::tempdir().unwrap();
        assert!(save_vfs(dir.path(), &json!(42)).is_err());
    }

    #[test]
    fn save_rejects_duplicate_project_ids() {
        let dir = tempfile::tempdir().unwrap();
        let bad = vfs(&[project("dup"), project("dup")], &[]);
        assert!(save_vfs(dir.path(), &bad).is_err());
    }

    #[test]
    fn save_rejects_missing_project_id() {
        let dir = tempfile::tempdir().unwrap();
        let bad = vfs(&[json!({ "name": "no id" })], &[]);
        assert!(save_vfs(dir.path(), &bad).is_err());
    }

    #[test]
    fn save_rejects_a_node_without_a_project_id() {
        let dir = tempfile::tempdir().unwrap();
        let bad = vfs(&[project("p")], &[file_node("n", "", None, "a.hcl", "")]);
        assert!(save_vfs(dir.path(), &bad).is_err());
    }

    /// Asserts that a payload carrying `name` in `build`'s position is refused
    /// and writes nothing. A name that cannot be one path segment arrives in
    /// two places — as the project's directory name and as a node's own — and
    /// both are the same refusal.
    fn assert_refused(name: &str, build: impl FnOnce(&str) -> Value) {
        let dir = tempfile::tempdir().unwrap();
        assert!(
            save_vfs(dir.path(), &build(name)).is_err(),
            "{name:?} should be refused"
        );
        assert!(dir_is_empty(dir.path()), "{name:?} wrote something");
    }

    #[test]
    fn save_rejects_a_project_id_that_is_not_an_address() {
        // The address is the directory name, so a traversal attempt here is
        // the same hole as one in a node name — and is refused before a single
        // byte is written.
        for id in ["../escape", "..", ".", "/etc", "Drone System", "drone/", ""] {
            assert_refused(id, |id| {
                vfs(&[project(id)], &[file_node("a.hcl", id, None, "a.hcl", "x")])
            });
        }
    }

    #[test]
    fn save_rejects_a_node_name_that_is_not_a_single_path_segment() {
        for name in ["views/main.hcl", "..", ".", "/etc/passwd", "a/../b", ""] {
            assert_refused(name, |name| {
                vfs(&[project("p")], &[file_node("n", "p", None, name, "x")])
            });
        }
    }

    #[test]
    fn save_rejects_a_parent_belonging_to_another_project() {
        let dir = tempfile::tempdir().unwrap();
        let bad = vfs(
            &[project("p"), project("q")],
            &[
                dir_node("a", "p", None, "a"),
                dir_node("b", "q", Some("a"), "b"),
            ],
        );
        assert!(save_vfs(dir.path(), &bad).is_err());
    }

    #[test]
    fn save_rejects_a_dangling_parent() {
        let dir = tempfile::tempdir().unwrap();
        let bad = vfs(
            &[project("p")],
            &[file_node("a", "p", Some("ghost"), "a.hcl", "x")],
        );
        assert!(save_vfs(dir.path(), &bad).is_err());
    }

    #[test]
    fn save_rejects_a_parent_cycle() {
        // A payload whose parents form a loop must be refused, not followed.
        let dir = tempfile::tempdir().unwrap();
        let bad = vfs(
            &[project("p")],
            &[
                dir_node("a", "p", Some("b"), "a"),
                dir_node("b", "p", Some("a"), "b"),
            ],
        );
        assert!(save_vfs(dir.path(), &bad).is_err());
    }

    #[test]
    fn save_rejects_a_file_used_as_a_parent() {
        let dir = tempfile::tempdir().unwrap();
        let bad = vfs(
            &[project("p")],
            &[
                file_node("a", "p", None, "a.hcl", "x"),
                file_node("b", "p", Some("a"), "b.hcl", "y"),
            ],
        );
        assert!(save_vfs(dir.path(), &bad).is_err());
    }

    #[test]
    fn save_rejects_two_nodes_resolving_to_the_same_path() {
        let dir = tempfile::tempdir().unwrap();
        let bad = vfs(
            &[project("p")],
            &[
                file_node("a", "p", None, "same.hcl", "x"),
                file_node("b", "p", None, "same.hcl", "y"),
            ],
        );
        assert!(save_vfs(dir.path(), &bad).is_err());
    }
}
