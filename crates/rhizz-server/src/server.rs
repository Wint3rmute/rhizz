//! HTTP server layer built on axum.
//!
//! This module owns the axum router: every route rhizz-server exposes —
//! liveness, the VFS persistence API, and the embedded frontend — is
//! assembled here, so handlers can be exercised in-process with
//! `tower::ServiceExt::oneshot` without binding a socket.

use std::path::PathBuf;

use axum::body::{Body, Bytes};
use axum::extract::State;
use axum::http::{StatusCode, Uri, header};
use axum::response::{IntoResponse, Response};
use axum::{Json, Router, routing::get};
use rust_embed::EmbeddedFile;
use serde_json::Value;

use crate::assets::StaticAssets;
use crate::storage;

/// Builds the complete axum router for the server.
///
/// Keep this as the single place that registers routes; the binary only
/// binds a listener and hands it to [`axum::serve()`].
pub fn app(data_dir: PathBuf) -> Router {
    Router::new()
        .route("/healthz", get(healthz))
        .route("/api/vfs", get(get_vfs).put(put_vfs))
        .fallback(get(spa_fallback))
        .with_state(data_dir)
}

/// Handles `GET /healthz`, used by orchestrators/tests to probe liveness.
async fn healthz() -> &'static str {
    "ok"
}

/// Fetches the entire VFS state (all projects + nodes), merged from the
/// per-project dumps on disk.
async fn get_vfs(State(data_dir): State<PathBuf>) -> Response {
    match storage::load_vfs(&data_dir) {
        Ok(vfs) => (StatusCode::OK, Json(vfs)).into_response(),
        Err(err) => {
            tracing::error!(?err, "failed to load VFS");
            error_response(StatusCode::INTERNAL_SERVER_ERROR, "failed to load VFS")
        }
    }
}

/// Persists the entire VFS state the frontend dumped on save. The payload
/// is authoritative: dumps for projects absent from it are deleted.
async fn put_vfs(State(data_dir): State<PathBuf>, body: Bytes) -> Response {
    let payload: Value = match serde_json::from_slice(&body) {
        Ok(payload) => payload,
        Err(err) => {
            tracing::debug!(?err, "rejected non-JSON VFS payload");
            return error_response(StatusCode::BAD_REQUEST, "invalid JSON");
        }
    };
    match storage::save_vfs(&data_dir, &payload) {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(err) => {
            // A malformed payload is the client's fault (400); a filesystem
            // failure is ours (500). The typed error keeps this distinction
            // reliable — downcasting through the anyhow context chain would
            // not be.
            let status = match err {
                storage::SaveVfsError::Malformed(_) => StatusCode::BAD_REQUEST,
                storage::SaveVfsError::Io(_) => StatusCode::INTERNAL_SERVER_ERROR,
            };
            tracing::error!(?err, ?status, "failed to persist VFS");
            error_response(status, "failed to persist VFS")
        }
    }
}

/// Serves the embedded frontend: real files as-is, everything else gets
/// the SPA shell (`404.html`) so client-side routes work at any path.
/// `/api/*` paths are never the shell — they 404 until a handler exists.
async fn spa_fallback(uri: Uri) -> Response {
    let path = uri.path();
    if path.starts_with("/api/") {
        return error_response(StatusCode::NOT_FOUND, "not found");
    }
    serve_path(path)
}

/// Serves `path` from the embedded assets. Missing paths that look like
/// real files (contain a `.`) 404; anything else gets the SPA shell.
fn serve_path(path: &str) -> Response {
    let relative = path.trim_start_matches('/');
    if relative.is_empty() {
        return spa_shell();
    }
    if let Some(file) = StaticAssets::get(relative) {
        return asset_response(file, relative);
    }
    if relative.contains('.') {
        return error_response(StatusCode::NOT_FOUND, "not found");
    }
    spa_shell()
}

/// The SPA shell page — the app entry the frontend build emits as
/// `404.html` (there is no `index.html` in a pure-SPA build).
fn spa_shell() -> Response {
    StaticAssets::get("404.html").map_or_else(
        || error_response(StatusCode::NOT_FOUND, "frontend not embedded"),
        |file| asset_response(file, "404.html"),
    )
}

/// Builds a response for one embedded file with its guessed mime type.
/// Hashed `_app` assets are immutable; the shell is revalidated.
fn asset_response(file: EmbeddedFile, path: &str) -> Response {
    let cache_control = if path.starts_with("_app/") {
        "public, max-age=31536000, immutable"
    } else {
        "no-cache"
    };
    let content_type = mime_guess::from_path(path).first_or_octet_stream();
    let builder = Response::builder()
        .header(header::CONTENT_TYPE, content_type.as_ref())
        .header(header::CACHE_CONTROL, cache_control);
    match builder.body(Body::from(file.data.into_owned())) {
        Ok(response) => response,
        Err(err) => {
            tracing::error!(?err, "failed to build asset response");
            error_response(StatusCode::INTERNAL_SERVER_ERROR, "internal server error")
        }
    }
}

/// Plain-text error response, used for paths outside the served app.
fn error_response(status: StatusCode, body: &'static str) -> Response {
    let builder = Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8");
    match builder.body(Body::from(body)) {
        Ok(response) => response,
        Err(err) => {
            tracing::error!(?err, "failed to build error response");
            Response::new(Body::from(body))
        }
    }
}

/// Binds a [`TcpListener`](tokio::net::TcpListener) to `addr` and serves
/// the [`app`] router until the listener is closed.
///
/// # Errors
///
/// Returns an error if the listener cannot bind to `addr` or if serving
/// fails after bind.
pub async fn run(addr: &str, data_dir: PathBuf) -> anyhow::Result<()> {
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!(%addr, data_dir = %data_dir.display(), "rhizz-server listening");
    axum::serve(listener, app(data_dir)).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::header;
    use axum::http::{Request, StatusCode};
    use serde_json::json;
    use tower::ServiceExt as _;

    fn app_at(tmp: &tempfile::TempDir) -> Router {
        app(tmp.path().to_path_buf())
    }

    #[tokio::test]
    async fn healthz_returns_200_and_ok() {
        let tmp = tempfile::tempdir().unwrap();
        let response = app_at(&tmp)
            .oneshot(
                Request::builder()
                    .uri("/healthz")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = axum::body::to_bytes(response.into_body(), 1024)
            .await
            .unwrap();
        assert_eq!(&body[..], b"ok");
    }

    #[tokio::test]
    async fn unknown_route_falls_back_to_spa_shell() {
        let tmp = tempfile::tempdir().unwrap();
        let response = app_at(&tmp)
            .oneshot(Request::builder().uri("/nope").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_content_type(&response, "text/html");
    }

    #[tokio::test]
    async fn root_serves_spa_shell() {
        let tmp = tempfile::tempdir().unwrap();
        let response = app_at(&tmp)
            .oneshot(Request::builder().uri("/").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_content_type(&response, "text/html");
        let body = axum::body::to_bytes(response.into_body(), 1024 * 1024)
            .await
            .unwrap();
        assert!(!body.is_empty());
    }

    #[tokio::test]
    async fn deep_client_route_falls_back_to_spa_shell() {
        let tmp = tempfile::tempdir().unwrap();
        let response = app_at(&tmp)
            .oneshot(
                Request::builder()
                    .uri("/projects/staging/diagrams")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_content_type(&response, "text/html");
    }

    #[tokio::test]
    async fn unknown_api_path_returns_404() {
        let tmp = tempfile::tempdir().unwrap();
        let response = app_at(&tmp)
            .oneshot(
                Request::builder()
                    .uri("/api/nope")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[cfg(rhizz_has_embedded_assets)]
    #[tokio::test]
    async fn embedded_asset_is_served_with_its_mime_type() {
        let tmp = tempfile::tempdir().unwrap();
        let response = app_at(&tmp)
            .oneshot(
                Request::builder()
                    .uri("/_app/version.json")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_content_type(&response, "application/json");
        // Hashed _app assets are immutable and cacheable long-term.
        assert_eq!(
            response.headers().get(header::CACHE_CONTROL).unwrap(),
            "public, max-age=31536000, immutable"
        );
    }

    // ── VFS persistence API ─────────────────────────────────────────

    #[tokio::test]
    async fn get_vfs_on_fresh_data_dir_returns_empty_vfs() {
        let tmp = tempfile::tempdir().unwrap();
        let response = app_at(&tmp)
            .oneshot(
                Request::builder()
                    .uri("/api/vfs")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = axum::body::to_bytes(response.into_body(), 1024 * 1024)
            .await
            .unwrap();
        let vfs: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(vfs.get("version").unwrap(), &json!(1));
        assert!(vfs.get("projects").unwrap().as_array().unwrap().is_empty());
        assert!(vfs.get("nodes").unwrap().as_array().unwrap().is_empty());
    }

    #[tokio::test]
    async fn put_then_get_vfs_round_trips() {
        let tmp = tempfile::tempdir().unwrap();
        let payload = json!({
            "version": 1,
            "projects": [
                { "id": "p1", "name": "Drone", "createdAt": "t0", "updatedAt": "t1" }
            ],
            "nodes": [
                { "id": "n1", "projectId": "p1", "parentId": null, "name": "system.hcl",
                  "kind": "file", "content": "component a {}", "revision": 2, "updatedAt": "t2" }
            ]
        });

        let response = app_at(&tmp)
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri("/api/vfs")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(payload.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);

        let response = app_at(&tmp)
            .oneshot(
                Request::builder()
                    .uri("/api/vfs")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let body = axum::body::to_bytes(response.into_body(), 1024 * 1024)
            .await
            .unwrap();
        let loaded: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(loaded, payload);
    }

    #[tokio::test]
    async fn put_vfs_rejects_invalid_json() {
        let tmp = tempfile::tempdir().unwrap();
        let response = app_at(&tmp)
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri("/api/vfs")
                    .body(Body::from("not json at all"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn put_vfs_rejects_non_object_payload() {
        let tmp = tempfile::tempdir().unwrap();
        let response = app_at(&tmp)
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri("/api/vfs")
                    .body(Body::from("42"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn put_vfs_rejects_payload_without_projects() {
        let tmp = tempfile::tempdir().unwrap();
        let response = app_at(&tmp)
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri("/api/vfs")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(json!({ "version": 1, "nodes": [] }).to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn put_vfs_maps_io_failure_to_500() {
        // A data dir that cannot be created (it's a regular file) forces a
        // filesystem error, which must surface as 500, not 400.
        let tmp = tempfile::tempdir().unwrap();
        let blocked = tmp.path().join("blocked");
        std::fs::write(&blocked, "not a directory").unwrap();
        let response = app(blocked)
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri("/api/vfs")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({ "version": 1, "projects": [], "nodes": [] }).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }

    fn assert_content_type(response: &axum::response::Response, expected: &str) {
        let value = response
            .headers()
            .get(header::CONTENT_TYPE)
            .unwrap()
            .to_str()
            .unwrap();
        assert!(
            value.starts_with(expected),
            "expected content-type to start with {expected:?}, got {value:?}"
        );
    }
}
