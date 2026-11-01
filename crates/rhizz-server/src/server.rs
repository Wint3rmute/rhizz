//! HTTP server layer built on axum.
//!
//! This module owns the axum router: every route the `rhizz web` subcommand
//! exposes — liveness, the VFS persistence API, and the embedded frontend —
//! is assembled here, so handlers can be exercised in-process with
//! `tower::ServiceExt::oneshot` without binding a socket.

use std::path::PathBuf;
use std::sync::Arc;

use axum::body::{Body, Bytes};
use axum::extract::{DefaultBodyLimit, Path, State};
use axum::http::{HeaderMap, StatusCode, Uri, header};
use axum::response::{IntoResponse, Response};
use axum::{Json, Router, routing::delete, routing::get, routing::post, routing::put};
use rmcp::transport::streamable_http_server::{
    StreamableHttpServerConfig, StreamableHttpService, session::local::LocalSessionManager,
};
use rust_embed::EmbeddedFile;
use serde_json::Value;

use crate::assets::StaticAssets;
use crate::locks::{AcquireOutcome, HeartbeatOutcome, LockManager};
use crate::mcp::RhizzMcp;
use crate::{sentry, storage};

/// Shared axum state: the data dir plus the in-memory project locks.
#[derive(Clone)]
struct AppState {
    /// Data dir holding one directory per project.
    data_dir: PathBuf,
    /// Who holds which project (proposal 0004).
    locks: LockManager,
}

/// Builds the complete axum router for the server.
///
/// Keep this as the single place that registers routes; the binary only
/// binds a listener and hands it to [`axum::serve()`].
pub fn app(data_dir: PathBuf) -> Router {
    // One lock manager for the whole server: HTTP writes and MCP mutations
    // contend on the same per-project locks (proposal 0004).
    let locks = LockManager::new();
    let mcp_data_dir = data_dir.clone();
    let mcp_locks = locks.clone();
    let mcp = StreamableHttpService::new(
        move || Ok(RhizzMcp::new(mcp_data_dir.clone(), mcp_locks.clone())),
        Arc::new(LocalSessionManager::default()),
        StreamableHttpServerConfig::default().with_allowed_hosts([
            "localhost",
            "127.0.0.1",
            "::1",
            "rhizz.fly.dev",
        ]),
    );
    Router::new()
        .route("/healthz", get(healthz))
        .route("/api/version", get(version))
        .route("/api/vfs", get(get_vfs).put(put_vfs_gone))
        .route("/api/projects/{id}/state", get(project_state))
        .route("/api/projects/{id}/lock", post(acquire_lock))
        .route("/api/projects/{id}/heartbeat", post(heartbeat_lock))
        .route("/api/projects/{id}/files", put(write_project_files))
        .route("/api/projects/{id}", delete(delete_project))
        .route(
            "/api/sentry",
            post(sentry_tunnel).layer(DefaultBodyLimit::max(SENTRY_ENVELOPE_LIMIT)),
        )
        // TODO: auth (bearer token / OAuth 2.1) before exposing beyond localhost
        .nest_service("/mcp", mcp)
        .fallback(get(spa_fallback))
        .with_state(AppState { data_dir, locks })
}

/// Handles `GET /healthz`, used by orchestrators/tests to probe liveness.
async fn healthz() -> &'static str {
    "ok"
}

/// Largest Sentry envelope accepted by `/api/sentry`. Session Replay chunks
/// and profiles can exceed axum's 2 MB default.
const SENTRY_ENVELOPE_LIMIT: usize = 10 * 1024 * 1024;

/// Tunnel endpoint the browser SDK posts envelopes to (`tunnel` option). The
/// envelope is checked to belong to our Sentry project, then forwarded as-is;
/// Sentry's status is passed back so the SDK can back off on rate limits.
async fn sentry_tunnel(body: Bytes) -> Response {
    if let Err(error) = sentry::check_envelope(&body) {
        tracing::warn!(%error, "rejected sentry envelope");
        return (StatusCode::BAD_REQUEST, error.to_string()).into_response();
    }
    match sentry::forward(body).await {
        Ok(status) => {
            tracing::debug!(%status, "forwarded sentry envelope");
            StatusCode::from_u16(status.as_u16())
                .unwrap_or(StatusCode::BAD_GATEWAY)
                .into_response()
        }
        Err(error) => {
            tracing::error!(%error, "failed to forward sentry envelope");
            StatusCode::BAD_GATEWAY.into_response()
        }
    }
}

/// The commit this binary was built from, injected by the build (see
/// `nix/backend.nix`). Local builds have no injected value and report `dev`.
const GIT_SHA: &str = match option_env!("RHIZZ_GIT_SHA") {
    Some(sha) => sha,
    None => "dev",
};

/// Handles `GET /api/version`: the commit the running server was built from.
async fn version() -> Json<Value> {
    Json(serde_json::json!({ "git_sha": GIT_SHA }))
}

/// Fetches the entire VFS state (all projects + nodes), expanded from the
/// project directories under the data dir.
async fn get_vfs(State(state): State<AppState>) -> Response {
    match storage::load_vfs(&state.data_dir) {
        Ok(vfs) => (StatusCode::OK, Json(vfs)).into_response(),
        Err(err) => {
            tracing::error!(?err, "failed to load VFS");
            error_response(StatusCode::INTERNAL_SERVER_ERROR, "failed to load VFS")
        }
    }
}

/// The whole-VFS `PUT /api/vfs` is gone: per-project writes
/// (`PUT /api/projects/{id}/files`) replaced it, so one client can no
/// longer overwrite or delete another client's projects. `GET /api/vfs`
/// stays for bootstrapping the project list.
async fn put_vfs_gone() -> Response {
    error_response(
        StatusCode::GONE,
        "PUT /api/vfs is gone; write per project with PUT /api/projects/{id}/files",
    )
}

/// Body of `PUT /api/projects/{id}/files`: the whole tree of one project.
/// `content` set means a file, absent means a directory; paths are
/// project-relative.
#[derive(Debug, serde::Deserialize)]
struct WriteFilesRequest {
    /// The version the writer based its edit on, from `GET .../state` or a
    /// lock response. `None` skips the check (lock-only).
    base_version: Option<String>,
    /// Every file and directory the project should hold; entries absent
    /// from the payload are deleted.
    files: Vec<storage::ProjectFileJson>,
}

/// Handles `PUT /api/projects/{id}/files`: replaces one project's tree
/// with the payload, creating the project when it does not exist yet.
/// The lock is taken first (free projects are auto-acquired; held-by-other
/// is 409 naming the holder), then an optional base-version check, then the
/// write — only this project's directory is ever touched.
async fn write_project_files(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let Some(user) = request_user(&headers) else {
        return error_response(StatusCode::BAD_REQUEST, "missing x-rhizz-user");
    };
    let request: WriteFilesRequest = match serde_json::from_slice(&body) {
        Ok(request) => request,
        Err(err) => {
            tracing::debug!(?err, "rejected non-JSON project files payload");
            return error_response(StatusCode::BAD_REQUEST, "invalid JSON");
        }
    };
    match storage::write_project(
        &state.data_dir,
        &state.locks,
        &id,
        &user,
        request.base_version.as_deref(),
        &request.files,
    ) {
        Ok(version) => {
            let Some(info) = state.locks.get(&id) else {
                tracing::error!("lock vanished right after writing the project");
                return error_response(StatusCode::INTERNAL_SERVER_ERROR, "failed to read project");
            };
            (
                StatusCode::OK,
                Json(serde_json::json!({
                    "lockedBy": info.holder,
                    "lockExpiresAt": lock_expiry_response(info.expires_at),
                    "version": version,
                })),
            )
                .into_response()
        }
        Err(storage::WriteProjectError::Unknown(_)) => {
            error_response(StatusCode::NOT_FOUND, "unknown project")
        }
        Err(storage::WriteProjectError::Locked { holder, .. }) => (
            StatusCode::CONFLICT,
            Json(serde_json::json!({
                "lockedBy": holder,
                "message": format!("project `{id}` is locked by `{holder}`"),
            })),
        )
            .into_response(),
        Err(storage::WriteProjectError::StaleVersion { current }) => (
            StatusCode::CONFLICT,
            Json(serde_json::json!({
                "version": current,
                "message": format!("project `{id}` changed since it was read; re-read and retry"),
            })),
        )
            .into_response(),
        Err(storage::WriteProjectError::Malformed(message)) => {
            (StatusCode::BAD_REQUEST, message).into_response()
        }
        Err(storage::WriteProjectError::Io(err)) => {
            tracing::error!(?err, "failed to write project");
            error_response(StatusCode::INTERNAL_SERVER_ERROR, "failed to write project")
        }
    }
}

/// Handles `DELETE /api/projects/{id}`: removes one project's directory.
/// The lock is taken first (free projects are auto-acquired; held-by-other
/// is 409 naming the holder), then the directory is removed and the lock
/// freed, so the address is immediately reusable.
async fn delete_project(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Response {
    let Some(user) = request_user(&headers) else {
        return error_response(StatusCode::BAD_REQUEST, "missing x-rhizz-user");
    };
    let root = match storage::resolve_project_dir(&state.data_dir, &id) {
        Ok(root) => root,
        Err(storage::ProjectError::Unknown(_)) => {
            return error_response(StatusCode::NOT_FOUND, "unknown project");
        }
        Err(storage::ProjectError::Io(err)) => {
            tracing::error!(?err, "failed to read project");
            return error_response(StatusCode::INTERNAL_SERVER_ERROR, "failed to read project");
        }
    };
    match state.locks.acquire(&id, &user) {
        AcquireOutcome::Acquired | AcquireOutcome::Renewed => {}
        AcquireOutcome::Refused { holder } => {
            return (
                StatusCode::CONFLICT,
                Json(serde_json::json!({
                    "lockedBy": holder,
                    "message": format!("project `{id}` is locked by `{holder}`"),
                })),
            )
                .into_response();
        }
    }
    if let Err(err) = std::fs::remove_dir_all(&root) {
        tracing::error!(?err, "failed to delete project");
        return error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "failed to delete project",
        );
    }
    state.locks.release(&id);
    StatusCode::NO_CONTENT.into_response()
}

/// Reads the `PoC` identity: the trimmed, non-empty [`crate::locks::USER_HEADER`].
fn request_user(headers: &HeaderMap) -> Option<String> {
    headers
        .get(crate::locks::USER_HEADER)?
        .to_str()
        .ok()
        .map(str::trim)
        .filter(|user| !user.is_empty())
        .map(ToOwned::to_owned)
}

/// Formats a lock expiry for API responses.
fn lock_expiry_response(expires_at: std::time::SystemTime) -> Value {
    Value::String(storage::format_rfc3339_millis(storage::millis_since_epoch(
        expires_at,
    )))
}

/// Handles `GET /api/projects/{id}/state`: the project's content-hash
/// version plus who holds its lock, if anyone. Watchers poll this to follow
/// the editor; edits made outside the web app (git, a text editor on the
/// data dir) show up as a version change.
async fn project_state(State(state): State<AppState>, Path(id): Path<String>) -> Response {
    let version = match storage::project_version(&state.data_dir, &id) {
        Ok(version) => version,
        Err(storage::ProjectError::Unknown(_)) => {
            return error_response(StatusCode::NOT_FOUND, "unknown project");
        }
        Err(storage::ProjectError::Io(err)) => {
            tracing::error!(?err, "failed to read project");
            return error_response(StatusCode::INTERNAL_SERVER_ERROR, "failed to read project");
        }
    };
    let mut state_body = serde_json::Map::new();
    state_body.insert("version".to_owned(), Value::String(version));
    state_body.insert("lockedBy".to_owned(), Value::Null);
    if let Some(info) = state.locks.get(&id) {
        state_body.insert("lockedBy".to_owned(), Value::String(info.holder));
        state_body.insert(
            "lockExpiresAt".to_owned(),
            lock_expiry_response(info.expires_at),
        );
    }
    (StatusCode::OK, Json(Value::Object(state_body))).into_response()
}

/// Handles `POST /api/projects/{id}/lock`: takes (or renews) the project's
/// lock for the `x-rhizz-user` caller. Held by someone else, the edit is
/// refused with 409 naming the holder. Successes also carry the project's
/// current version, so the new holder can chain its first write without
/// another round trip (0004.2).
async fn acquire_lock(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Response {
    let Some(user) = request_user(&headers) else {
        return error_response(StatusCode::BAD_REQUEST, "missing x-rhizz-user");
    };
    match storage::resolve_project_dir(&state.data_dir, &id) {
        Ok(_) => {}
        Err(storage::ProjectError::Unknown(_)) => {
            return error_response(StatusCode::NOT_FOUND, "unknown project");
        }
        Err(storage::ProjectError::Io(err)) => {
            tracing::error!(?err, "failed to read project");
            return error_response(StatusCode::INTERNAL_SERVER_ERROR, "failed to read project");
        }
    }
    match state.locks.acquire(&id, &user) {
        AcquireOutcome::Acquired | AcquireOutcome::Renewed => {
            let Some(info) = state.locks.get(&id) else {
                tracing::error!("lock vanished right after acquiring it");
                return error_response(StatusCode::INTERNAL_SERVER_ERROR, "failed to read project");
            };
            let version = match storage::project_version(&state.data_dir, &id) {
                Ok(version) => version,
                Err(err) => {
                    tracing::error!(?err, "failed to read project");
                    return error_response(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "failed to read project",
                    );
                }
            };
            (
                StatusCode::OK,
                Json(serde_json::json!({
                    "lockedBy": info.holder,
                    "lockExpiresAt": lock_expiry_response(info.expires_at),
                    "version": version,
                })),
            )
                .into_response()
        }
        AcquireOutcome::Refused { holder } => (
            StatusCode::CONFLICT,
            Json(serde_json::json!({
                "lockedBy": holder,
                "message": format!("project `{id}` is locked by `{holder}`"),
            })),
        )
            .into_response(),
    }
}

/// Handles `POST /api/projects/{id}/heartbeat`: renews the lease for the
/// `x-rhizz-user` holder without touching the idle timer. Not held by this
/// user, the client must re-acquire through the lock endpoint (409).
async fn heartbeat_lock(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Response {
    let Some(user) = request_user(&headers) else {
        return error_response(StatusCode::BAD_REQUEST, "missing x-rhizz-user");
    };
    match storage::resolve_project_dir(&state.data_dir, &id) {
        Ok(_) => {}
        Err(storage::ProjectError::Unknown(_)) => {
            return error_response(StatusCode::NOT_FOUND, "unknown project");
        }
        Err(storage::ProjectError::Io(err)) => {
            tracing::error!(?err, "failed to read project");
            return error_response(StatusCode::INTERNAL_SERVER_ERROR, "failed to read project");
        }
    }
    match state.locks.heartbeat(&id, &user) {
        HeartbeatOutcome::Renewed => {
            let Some(info) = state.locks.get(&id) else {
                tracing::error!("lock vanished right after renewing it");
                return error_response(StatusCode::INTERNAL_SERVER_ERROR, "failed to read project");
            };
            let version = match storage::project_version(&state.data_dir, &id) {
                Ok(version) => version,
                Err(err) => {
                    tracing::error!(?err, "failed to read project");
                    return error_response(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "failed to read project",
                    );
                }
            };
            (
                StatusCode::OK,
                Json(serde_json::json!({
                    "lockedBy": info.holder,
                    "lockExpiresAt": lock_expiry_response(info.expires_at),
                    "version": version,
                })),
            )
                .into_response()
        }
        HeartbeatOutcome::NotHeld { holder } => (
            StatusCode::CONFLICT,
            Json(serde_json::json!({
                "lockedBy": holder,
                "message": format!("project `{id}` is not held by `{user}`"),
            })),
        )
            .into_response(),
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

/// Serves `path` from the embedded assets. Any path that isn't a real
/// embedded file gets the SPA shell — the client router decides whether a
/// route is valid and renders its own 404. We deliberately don't try to
/// guess which paths are "real" routes: client-side routes can contain
/// dots in path segments (e.g. `/diagrams/embed/main.hcl`), so a
/// "contains a dot ⇒ 404" heuristic would break them.
fn serve_path(path: &str) -> Response {
    let relative = path.trim_start_matches('/');
    if relative.is_empty() {
        return spa_shell();
    }
    if let Some(file) = StaticAssets::get(relative) {
        return asset_response(file, relative);
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
///
/// HTML documents additionally carry `Document-Policy: js-profiling`: the
/// browser JS self-profiler (see `web/src/hooks.client.ts`) only starts when
/// the document response includes it. Dev documents go through `SvelteKit`'s
/// `hooks.server.ts`, which sets the same header there.
fn asset_response(file: EmbeddedFile, path: &str) -> Response {
    let cache_control = if path.starts_with("_app/") {
        "public, max-age=31536000, immutable"
    } else {
        "no-cache"
    };
    let content_type = mime_guess::from_path(path).first_or_octet_stream();
    let mut builder = Response::builder()
        .header(header::CONTENT_TYPE, content_type.as_ref())
        .header(header::CACHE_CONTROL, cache_control);
    if content_type == mime_guess::mime::TEXT_HTML {
        builder = builder.header("Document-Policy", "js-profiling");
    }
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
    tracing::info!(%addr, data_dir = %data_dir.display(), "rhizz web listening");

    // Wait for a termination signal (SIGINT / SIGTERM) and then shut the
    // server down gracefully. Running as PID 1 (the container's init), the
    // kernel does NOT apply default dispositions to us, so SIGINT/SIGTERM
    // would otherwise be silently dropped — that's why running the image
    // locally with `docker run` didn't react to Ctrl-C.
    let shutdown = crate::signal::shutdown_signal();
    axum::serve(listener, app(data_dir))
        .with_graceful_shutdown(shutdown)
        .await?;
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
    async fn version_reports_the_build_commit() {
        let tmp = tempfile::tempdir().unwrap();
        let response = app_at(&tmp)
            .oneshot(
                Request::builder()
                    .uri("/api/version")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = axum::body::to_bytes(response.into_body(), 1024)
            .await
            .unwrap();
        let json: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json, json!({ "git_sha": GIT_SHA }));
        assert!(!GIT_SHA.is_empty());
    }

    #[tokio::test]
    async fn client_routes_fall_back_to_spa_shell() {
        // Table-driven consolidation of the former unknown_route,
        // deep_client_route, and dot_in_segment fallback tests: same
        // 200 + text/html assertion, only the URI differs. Mirrors the
        // existing loop in spa_shell_carries_document_policy_for_profiling.
        // The last URI covers a client-side route whose path contains a dot
        // in a segment (here the `main.hcl` file name) — it must still get
        // the SPA shell, not a missing-asset error.
        for uri in [
            "/nope",
            "/projects/staging/diagrams",
            "/projects/04e58d81-8bc3-4cc6-9a04-b9da48b996bb/diagrams/embed/main.hcl",
        ] {
            let tmp = tempfile::tempdir().unwrap();
            let response = app_at(&tmp)
                .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK, "uri: {uri}");
            assert_content_type(&response, "text/html");
        }
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
    async fn spa_shell_carries_document_policy_for_profiling() {
        // The browser JS self-profiler only starts when the document response
        // carries `Document-Policy: js-profiling` (see
        // `web/src/hooks.client.ts`). Every path that serves the SPA shell is
        // a document, so all of them must carry it.
        let tmp = tempfile::tempdir().unwrap();
        for uri in ["/", "/nope", "/projects/staging/diagrams"] {
            let response = app_at(&tmp)
                .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK);
            assert_eq!(
                response.headers().get("Document-Policy").unwrap(),
                "js-profiling",
                "missing Document-Policy header on {uri}",
            );
        }
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

    #[tokio::test]
    async fn sentry_tunnel_rejects_envelope_for_another_project() {
        let tmp = tempfile::tempdir().unwrap();
        let response = app_at(&tmp)
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/sentry")
                    .header(header::CONTENT_TYPE, "application/x-sentry-envelope")
                    .body(Body::from(
                        "{\"dsn\":\"https://key@o1.ingest.sentry.io/1\"}\n{}",
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn sentry_tunnel_only_accepts_post() {
        let tmp = tempfile::tempdir().unwrap();
        let response = app_at(&tmp)
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri("/api/sentry")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::METHOD_NOT_ALLOWED);
    }

    #[tokio::test]
    async fn sentry_tunnel_accepts_envelope_larger_than_axum_default_limit() {
        let tmp = tempfile::tempdir().unwrap();
        let body = vec![b'x'; 3 * 1024 * 1024];
        let response = app_at(&tmp)
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/sentry")
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();
        // Past axum's 2 MB default, so the 10 MB route limit must let it through
        // to the handler, which rejects it as an invalid envelope.
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
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
    async fn put_vfs_is_gone() {
        // The whole-VFS PUT is replaced by per-project writes: one client
        // can no longer overwrite or delete another's projects. GET stays
        // for bootstrapping the project list.
        let tmp = tempfile::tempdir().unwrap();
        let response = app_at(&tmp)
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
        assert_eq!(response.status(), StatusCode::GONE);
    }

    #[tokio::test]
    async fn put_files_creates_a_project_and_round_trips_through_get_vfs() {
        let tmp = tempfile::tempdir().unwrap();
        let app = app_at(&tmp);
        let payload = json!({
            "files": [
                { "path": "system.hcl", "content": "system \"drone\" {}\n" },
                { "path": "views" },
                { "path": "views/main.hcl", "content": "view \"main\" {}\n" },
            ]
        });

        let response = app
            .clone()
            .oneshot(put_files_request(
                "/api/projects/p1/files",
                Some("alice"),
                &payload,
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = body_json(response).await;
        assert_eq!(body["lockedBy"], json!("alice"));
        assert!(
            body["lockExpiresAt"].as_str().is_some(),
            "expiry must be present: {body}"
        );
        assert_eq!(
            body["version"],
            json!(storage::project_version(tmp.path(), "p1").unwrap())
        );

        // The payload landed as real files, addressed by path.
        assert_eq!(
            std::fs::read_to_string(tmp.path().join("p1/system.hcl")).unwrap(),
            "system \"drone\" {}\n"
        );
        assert_eq!(
            std::fs::read_to_string(tmp.path().join("p1/views/main.hcl")).unwrap(),
            "view \"main\" {}\n"
        );

        // And GET /api/vfs now lists the new project.
        let response = app
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
        assert_eq!(loaded["projects"][0]["id"], json!("p1"));
    }

    #[tokio::test]
    async fn put_files_refuses_a_strangers_write_and_leaves_the_disk_untouched() {
        let tmp = data_dir_with_drone();
        let app = app_at(&tmp);
        let before = std::fs::read_to_string(tmp.path().join("drone/system.hcl")).unwrap();

        // Alice takes the lock …
        let response = app
            .clone()
            .oneshot(lock_request(
                "POST",
                "/api/projects/drone/lock",
                Some("alice"),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        // … so Bob's write is refused with Alice named, byte-identical.
        let payload = json!({
            "files": [{ "path": "system.hcl", "content": "system \"hijacked\" {}\n" }]
        });
        let response = app
            .oneshot(put_files_request(
                "/api/projects/drone/files",
                Some("bob"),
                &payload,
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CONFLICT);
        assert_eq!(body_json(response).await["lockedBy"], json!("alice"));
        assert_eq!(
            std::fs::read_to_string(tmp.path().join("drone/system.hcl")).unwrap(),
            before,
            "a refused write must leave the file untouched"
        );
    }

    #[tokio::test]
    async fn put_files_refuses_a_stale_base_version() {
        let tmp = data_dir_with_drone();
        let app = app_at(&tmp);
        let stale = storage::project_version(tmp.path(), "drone").unwrap();
        // An outside edit moves the version …
        std::fs::write(
            tmp.path().join("drone/system.hcl"),
            "system \"edited-elsewhere\" {}\n",
        )
        .unwrap();
        let current = storage::project_version(tmp.path(), "drone").unwrap();

        let payload = json!({
            "base_version": stale,
            "files": [{ "path": "system.hcl", "content": "system \"mine\" {}\n" }],
        });
        let response = app
            .clone()
            .oneshot(put_files_request(
                "/api/projects/drone/files",
                Some("alice"),
                &payload,
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CONFLICT);
        let body = body_json(response).await;
        assert_eq!(body["version"], json!(current));
        assert_eq!(
            std::fs::read_to_string(tmp.path().join("drone/system.hcl")).unwrap(),
            "system \"edited-elsewhere\" {}\n"
        );

        // … and the fresh version applies — the refused write never gave the
        // auto-acquired lock away.
        let payload = json!({
            "base_version": body["version"].as_str().unwrap(),
            "files": [{ "path": "system.hcl", "content": "system \"mine\" {}\n" }],
        });
        let response = app
            .oneshot(put_files_request(
                "/api/projects/drone/files",
                Some("alice"),
                &payload,
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            std::fs::read_to_string(tmp.path().join("drone/system.hcl")).unwrap(),
            "system \"mine\" {}\n"
        );
    }

    #[tokio::test]
    async fn put_files_rejects_unwritable_paths_and_bad_payloads() {
        let tmp = data_dir_with_drone();
        let before = std::fs::read_to_string(tmp.path().join("drone/system.hcl")).unwrap();

        for files in [
            json!([{ "path": "../escape.hcl", "content": "x" }]),
            json!([{ "path": "/etc/passwd", "content": "x" }]),
            json!([{ "path": "views/.hidden", "content": "x" }]),
            // A file whose parent directory is not listed.
            json!([{ "path": "views/main.hcl", "content": "x" }]),
            // A parent that is a file, not a directory.
            json!([
                { "path": "views", "content": "x" },
                { "path": "views/main.hcl", "content": "y" },
            ]),
            // Two entries for one path.
            json!([
                { "path": "dup.hcl", "content": "x" },
                { "path": "dup.hcl", "content": "y" },
            ]),
        ] {
            let response = app_at(&tmp)
                .oneshot(put_files_request(
                    "/api/projects/drone/files",
                    Some("alice"),
                    &json!({ "files": files }),
                ))
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::BAD_REQUEST, "files: {files}");
        }

        // Invalid JSON, a missing user, and a bad address are refused too.
        let bad_json = Request::builder()
            .method("PUT")
            .uri("/api/projects/drone/files")
            .header(header::CONTENT_TYPE, "application/json")
            .header(crate::locks::USER_HEADER, "alice")
            .body(Body::from("not json at all"))
            .unwrap();
        let response = app_at(&tmp).oneshot(bad_json).await.unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);

        let no_user = put_files_request("/api/projects/drone/files", None, &json!({ "files": [] }));
        let response = app_at(&tmp).oneshot(no_user).await.unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);

        assert_eq!(
            std::fs::read_to_string(tmp.path().join("drone/system.hcl")).unwrap(),
            before,
            "refused writes must leave the tree untouched"
        );
    }

    #[tokio::test]
    async fn put_files_leaves_sibling_projects_alone() {
        let tmp = data_dir_with_drone();
        std::fs::create_dir_all(tmp.path().join("web-app")).unwrap();
        std::fs::write(tmp.path().join("web-app/system.hcl"), "system \"web\" {}\n").unwrap();
        let web_before = std::fs::read_to_string(tmp.path().join("web-app/system.hcl")).unwrap();

        // A payload that drops every file still only manages `drone`.
        let payload = json!({
            "files": [{ "path": "system.hcl", "content": "system \"q\" {}\n" }]
        });
        let response = app_at(&tmp)
            .oneshot(put_files_request(
                "/api/projects/drone/files",
                Some("alice"),
                &payload,
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        assert!(!tmp.path().join("drone/views").exists());
        assert_eq!(
            std::fs::read_to_string(tmp.path().join("web-app/system.hcl")).unwrap(),
            web_before
        );
    }

    #[tokio::test]
    async fn delete_project_removes_the_directory_and_frees_the_lock() {
        let tmp = data_dir_with_drone();
        let app = app_at(&tmp);

        let response = app
            .clone()
            .oneshot(lock_request("DELETE", "/api/projects/drone", Some("alice")))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);
        assert!(!tmp.path().join("drone").exists());

        // State is gone too, and the address is immediately reusable.
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/projects/drone/state")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);

        let payload = json!({
            "files": [{ "path": "system.hcl", "content": "system \"again\" {}\n" }]
        });
        let response = app
            .oneshot(put_files_request(
                "/api/projects/drone/files",
                Some("alice"),
                &payload,
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn delete_project_refuses_strangers_and_unknown_projects() {
        let tmp = data_dir_with_drone();
        let app = app_at(&tmp);

        let response = app
            .clone()
            .oneshot(lock_request(
                "POST",
                "/api/projects/drone/lock",
                Some("alice"),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        let response = app
            .clone()
            .oneshot(lock_request("DELETE", "/api/projects/drone", Some("bob")))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CONFLICT);
        assert_eq!(body_json(response).await["lockedBy"], json!("alice"));
        assert!(tmp.path().join("drone").is_dir());

        let response = app
            .clone()
            .oneshot(lock_request("DELETE", "/api/projects/drone", None))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);

        let response = app
            .oneshot(lock_request("DELETE", "/api/projects/ghost", Some("alice")))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn get_vfs_serves_a_data_dir_of_project_directories() {
        // The layout rhizz-server is meant to serve: a directory per project,
        // named by its address, holding ordinary HCL.
        let tmp = tempfile::tempdir().unwrap();
        let drone = tmp.path().join("drone");
        std::fs::create_dir_all(drone.join("views")).unwrap();
        std::fs::write(drone.join("system.hcl"), "system \"quadcopter\" {}\n").unwrap();
        std::fs::write(drone.join("views/main.hcl"), "view \"main\" {}\n").unwrap();
        // A stray file at the data-dir root is not a project.
        std::fs::write(tmp.path().join("README.md"), "readme\n").unwrap();

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
        let loaded: Value = serde_json::from_slice(&body).unwrap();

        assert_eq!(loaded["version"], json!(1));
        let projects = loaded["projects"].as_array().unwrap();
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0]["id"], json!("drone"));
        assert_eq!(projects[0]["name"], json!("drone"));
        assert_eq!(loaded["nodes"].as_array().unwrap().len(), 3);
    }

    // ── Project locks (proposal 0004) ───────────────────────────────────

    /// A data dir holding one `drone` project with a model source.
    fn data_dir_with_drone() -> tempfile::TempDir {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(tmp.path().join("drone/views")).unwrap();
        std::fs::write(
            tmp.path().join("drone/system.hcl"),
            "system \"quadcopter\" {}\n",
        )
        .unwrap();
        std::fs::write(
            tmp.path().join("drone/views/main.hcl"),
            "view \"main\" {}\n",
        )
        .unwrap();
        tmp
    }

    /// Builds a lock/heartbeat/state request carrying the `PoC` identity
    /// header, when `user` is set.
    fn lock_request(method: &str, uri: &str, user: Option<&str>) -> Request<Body> {
        let mut builder = Request::builder().method(method).uri(uri);
        if let Some(user) = user {
            builder = builder.header(crate::locks::USER_HEADER, user);
        }
        builder.body(Body::empty()).unwrap()
    }

    /// Builds a `PUT .../files` request with a JSON body and the `PoC`
    /// identity header, when `user` is set.
    fn put_files_request(uri: &str, user: Option<&str>, payload: &Value) -> Request<Body> {
        let mut builder = Request::builder()
            .method("PUT")
            .uri(uri)
            .header(header::CONTENT_TYPE, "application/json");
        if let Some(user) = user {
            builder = builder.header(crate::locks::USER_HEADER, user);
        }
        builder.body(Body::from(payload.to_string())).unwrap()
    }

    /// Reads a whole response body as JSON.
    async fn body_json(response: Response) -> Value {
        let bytes = axum::body::to_bytes(response.into_body(), 1024 * 1024)
            .await
            .unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }

    #[tokio::test]
    async fn project_state_returns_version_and_no_lock_for_a_free_project() {
        let tmp = data_dir_with_drone();
        let response = app_at(&tmp)
            .oneshot(
                Request::builder()
                    .uri("/api/projects/drone/state")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = body_json(response).await;
        assert_eq!(
            body["version"],
            json!(storage::project_version(tmp.path(), "drone").unwrap())
        );
        assert_eq!(body["lockedBy"], json!(null));
        assert!(body.get("lockExpiresAt").is_none());
    }

    #[tokio::test]
    async fn project_state_is_404_for_an_unknown_project() {
        let tmp = data_dir_with_drone();
        let response = app_at(&tmp)
            .oneshot(
                Request::builder()
                    .uri("/api/projects/ghost/state")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn lock_acquire_reports_the_holder_and_refuses_strangers() {
        let tmp = data_dir_with_drone();
        let app = app_at(&tmp);

        let response = app
            .clone()
            .oneshot(lock_request(
                "POST",
                "/api/projects/drone/lock",
                Some("alice"),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = body_json(response).await;
        assert_eq!(body["lockedBy"], json!("alice"));
        assert!(
            body["lockExpiresAt"]
                .as_str()
                .is_some_and(|expires| expires.contains('T')),
            "expiry must be a timestamp: {body}"
        );
        assert_eq!(
            body["version"],
            json!(storage::project_version(tmp.path(), "drone").unwrap())
        );

        let response = app
            .clone()
            .oneshot(lock_request(
                "POST",
                "/api/projects/drone/lock",
                Some("bob"),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CONFLICT);
        assert_eq!(body_json(response).await["lockedBy"], json!("alice"));

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/projects/drone/state")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let body = body_json(response).await;
        assert_eq!(body["lockedBy"], json!("alice"));
        assert!(body["lockExpiresAt"].as_str().is_some());

        // The holder renews instead of refusing itself.
        let response = app
            .oneshot(lock_request(
                "POST",
                "/api/projects/drone/lock",
                Some("alice"),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn lock_requires_a_username() {
        let tmp = data_dir_with_drone();
        for user in [None, Some(""), Some("   ")] {
            let response = app_at(&tmp)
                .oneshot(lock_request("POST", "/api/projects/drone/lock", user))
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::BAD_REQUEST, "user: {user:?}");
        }
    }

    #[tokio::test]
    async fn lock_is_404_for_an_unknown_project() {
        let tmp = data_dir_with_drone();
        let response = app_at(&tmp)
            .oneshot(lock_request(
                "POST",
                "/api/projects/ghost/lock",
                Some("alice"),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn heartbeat_renews_for_the_holder_and_refuses_strangers() {
        let tmp = data_dir_with_drone();
        let app = app_at(&tmp);

        // Nobody holds it yet: the heartbeat has nothing to renew.
        let response = app
            .clone()
            .oneshot(lock_request(
                "POST",
                "/api/projects/drone/heartbeat",
                Some("alice"),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CONFLICT);
        assert_eq!(body_json(response).await["lockedBy"], json!(null));

        let response = app
            .clone()
            .oneshot(lock_request(
                "POST",
                "/api/projects/drone/lock",
                Some("alice"),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        let response = app
            .clone()
            .oneshot(lock_request(
                "POST",
                "/api/projects/drone/heartbeat",
                Some("alice"),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(body_json(response).await["lockedBy"], json!("alice"));

        let response = app
            .clone()
            .oneshot(lock_request(
                "POST",
                "/api/projects/drone/heartbeat",
                Some("bob"),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CONFLICT);
        assert_eq!(body_json(response).await["lockedBy"], json!("alice"));

        let response = app
            .oneshot(lock_request("POST", "/api/projects/drone/heartbeat", None))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn state_version_moves_after_an_outside_edit() {
        // Edits made outside the web app are not covered by locks, but they
        // still show up to watchers as a version change.
        let tmp = data_dir_with_drone();
        let app = app_at(&tmp);
        let state = || async {
            let response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .uri("/api/projects/drone/state")
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK);
            body_json(response).await
        };

        let before = state().await;
        std::fs::write(
            tmp.path().join("drone/system.hcl"),
            "system \"edited-elsewhere\" {}\n",
        )
        .unwrap();
        let after = state().await;
        assert_ne!(before["version"], after["version"]);
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
