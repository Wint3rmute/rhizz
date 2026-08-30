//! Filesystem persistence for the VFS API.
//!
//! The server is a dumb store: it persists exactly what the frontend
//! dumps, with no schema interpretation of its own (the frontend's zod
//! validation owns correctness). Disk layout is one JSON file per
//! project — `<data_dir>/<project-id>.json` — holding `{ "project": …,
//! "nodes": […] }`; `load_vfs` merges every file into the whole-VFS shape
//! `{ "version": 1, "projects": […], "nodes": […] }` and `save_vfs`
//! splits a whole-VFS payload back into per-project files, deleting files
//! for projects absent from the payload.
//!
//! Data dir default is `rhizz-data` (relative to the server's cwd);
//! override with `RHIZZ_DATA_DIR`.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context as _, Result};
use serde_json::Value;
use thiserror::Error;

/// VFS blob version written into every response, mirroring the frontend's.
const VFS_VERSION: u64 = 1;

/// File suffix for per-project dumps.
const PROJECT_FILE_SUFFIX: &str = ".json";

/// The whole-VFS shape with empty project/node collections.
fn empty_vfs() -> Value {
    serde_json::json!({
        "version": VFS_VERSION,
        "projects": [],
        "nodes": [],
    })
}

/// Per-project file path for `project_id`.
fn project_file(data_dir: &Path, project_id: &str) -> PathBuf {
    data_dir.join(format!("{project_id}{PROJECT_FILE_SUFFIX}"))
}

/// Reads every `*.json` file in `data_dir` and merges them into one
/// whole-VFS blob. A missing or empty data dir yields an empty VFS.
///
/// # Errors
///
/// Returns an error if a project file exists but cannot be read or parsed
/// as JSON.
pub fn load_vfs(data_dir: &Path) -> Result<Value> {
    let mut vfs = empty_vfs();

    if !data_dir.is_dir() {
        return Ok(vfs);
    }

    let mut projects: Vec<Value> = Vec::new();
    let mut nodes: Vec<Value> = Vec::new();
    let mut project_files: Vec<PathBuf> = Vec::new();
    for entry in fs::read_dir(data_dir)
        .with_context(|| format!("cannot read data dir {}", data_dir.display()))?
    {
        let entry =
            entry.with_context(|| format!("cannot read entry in {}", data_dir.display()))?;
        let is_dump = entry
            .path()
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|name| name.ends_with(PROJECT_FILE_SUFFIX));
        if is_dump {
            project_files.push(entry.path());
        }
    }
    // Deterministic merge order (read_dir order is filesystem-dependent).
    project_files.sort();
    for path in project_files {
        let raw = fs::read_to_string(&path)
            .with_context(|| format!("cannot read project file {}", path.display()))?;
        let value: Value = serde_json::from_str(&raw)
            .with_context(|| format!("project file {} is not valid JSON", path.display()))?;
        let Some(project) = value.get("project") else {
            continue;
        };
        projects.push(project.clone());
        if let Some(file_nodes) = value.get("nodes").and_then(Value::as_array) {
            nodes.extend(file_nodes.iter().cloned());
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
    /// The payload does not match the whole-VFS shape.
    #[error("{0}")]
    Malformed(String),
    /// The data dir could not be read or written.
    #[error("{0}")]
    Io(#[from] std::io::Error),
}

/// Persists a whole-VFS payload as one file per project.
///
/// The payload must be an object with a `projects` array (and a `nodes`
/// array); every project must carry a unique string `id`. Files for
/// projects absent from the payload are deleted — the payload is the
/// entire VFS state, not a delta. Writes go through a temp file + rename
/// so a crash cannot leave a half-written dump.
///
/// # Errors
///
/// Returns [`SaveVfsError::Malformed`] for malformed payloads (the caller
/// maps it to 400) or [`SaveVfsError::Io`] when the data dir cannot be
/// written (maps to 500).
pub fn save_vfs(data_dir: &Path, payload: &Value) -> Result<(), SaveVfsError> {
    let obj = payload
        .as_object()
        .ok_or_else(|| SaveVfsError::Malformed("payload must be a JSON object".to_owned()))?;
    let Some(projects) = obj.get("projects").and_then(Value::as_array).cloned() else {
        return Err(SaveVfsError::Malformed(
            "payload must have a `projects` array".to_owned(),
        ));
    };
    let nodes = obj
        .get("nodes")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let mut seen_ids: HashSet<&str> = HashSet::new();
    let mut nodes_by_project: HashMap<&str, Vec<Value>> = HashMap::new();
    for project in &projects {
        let Some(id) = project.get("id").and_then(Value::as_str) else {
            return Err(SaveVfsError::Malformed(
                "every project must have a string `id`".to_owned(),
            ));
        };
        if !seen_ids.insert(id) {
            return Err(SaveVfsError::Malformed(format!(
                "duplicate project id `{id}`"
            )));
        }
        nodes_by_project.insert(id, Vec::new());
    }
    for node in &nodes {
        let Some(project_id) = node.get("projectId").and_then(Value::as_str) else {
            return Err(SaveVfsError::Malformed(
                "every node must have a string `projectId`".to_owned(),
            ));
        };
        if let Some(project_nodes) = nodes_by_project.get_mut(project_id) {
            project_nodes.push(node.clone());
        }
    }

    fs::create_dir_all(data_dir)?;
    for project in &projects {
        let id = project
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(|| SaveVfsError::Malformed("project id must be a string".to_owned()))?;
        let file_payload = serde_json::json!({ "project": project, "nodes": nodes_by_project.remove(id).unwrap_or_default() });
        let target = project_file(data_dir, id);
        let tmp = data_dir.join(format!(".{id}.tmp"));
        let serialized = serde_json::to_string_pretty(&file_payload)
            .map_err(|err| SaveVfsError::Io(err.into()))?;
        fs::write(&tmp, serialized)?;
        fs::rename(&tmp, &target)?;
    }

    // Delete dumps for projects absent from the payload.
    let existing = fs::read_dir(data_dir)?;
    for entry in existing {
        let entry = entry?;
        let path = entry.path();
        let Some(file_name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        let Some(project_id) = file_name.strip_suffix(PROJECT_FILE_SUFFIX) else {
            continue;
        };
        if !seen_ids.contains(project_id) {
            fs::remove_file(&path)?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sample_project(id: &str) -> Value {
        json!({ "id": id, "name": "Sample", "createdAt": "t0", "updatedAt": "t1" })
    }

    fn sample_vfs() -> Value {
        json!({
            "version": 1,
            "projects": [sample_project("p1"), sample_project("p2")],
            "nodes": [
                { "id": "n1", "projectId": "p1", "parentId": null, "name": "system.hcl",
                  "kind": "file", "content": "component a {}", "revision": 3, "updatedAt": "t2" },
                { "id": "n2", "projectId": "p2", "parentId": null, "name": "views.hcl",
                  "kind": "file", "content": "view v {}", "revision": 1, "updatedAt": "t3" }
            ]
        })
    }

    #[test]
    fn save_then_load_round_trips_the_whole_vfs() {
        let dir = tempfile::tempdir().unwrap();
        save_vfs(dir.path(), &sample_vfs()).unwrap();
        let loaded = load_vfs(dir.path()).unwrap();
        assert_eq!(loaded, sample_vfs());
    }

    #[test]
    fn load_on_missing_dir_yields_empty_vfs() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("does-not-exist");
        let loaded = load_vfs(&missing).unwrap();
        assert_eq!(loaded, empty_vfs());
    }

    #[test]
    fn save_removes_dumps_for_projects_absent_from_payload() {
        let dir = tempfile::tempdir().unwrap();
        save_vfs(dir.path(), &sample_vfs()).unwrap();
        let shrunk = json!({
            "version": 1,
            "projects": [sample_project("p1")],
            "nodes": []
        });
        save_vfs(dir.path(), &shrunk).unwrap();
        let loaded = load_vfs(dir.path()).unwrap();
        assert_eq!(loaded, shrunk);
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn save_rejects_payload_without_projects() {
        let dir = tempfile::tempdir().unwrap();
        let bad = json!({ "version": 1, "nodes": [] });
        assert!(save_vfs(dir.path(), &bad).is_err());
    }

    #[test]
    fn save_rejects_duplicate_project_ids() {
        let dir = tempfile::tempdir().unwrap();
        let bad = json!({
            "version": 1,
            "projects": [sample_project("dup"), sample_project("dup")],
            "nodes": []
        });
        assert!(save_vfs(dir.path(), &bad).is_err());
    }

    #[test]
    fn save_rejects_missing_project_id() {
        let dir = tempfile::tempdir().unwrap();
        let bad = json!({ "version": 1, "projects": [{ "name": "no id" }], "nodes": [] });
        assert!(save_vfs(dir.path(), &bad).is_err());
    }
}
