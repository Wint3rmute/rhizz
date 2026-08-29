//! HTTP server layer built on axum.
//!
//! This module owns the axum router: every route rhizz-server exposes —
//! currently just the `/healthz` sample route — is assembled here, so
//! handlers can be exercised in-process with `tower::ServiceExt::oneshot`
//! without binding a socket.

use axum::body::Body;
use axum::http::{StatusCode, Uri, header};
use axum::response::Response;
use axum::{Router, routing::get};
use rust_embed::EmbeddedFile;

use crate::assets::StaticAssets;
/// Builds the complete axum router for the server.
///
/// Keep this as the single place that registers routes; the binary only
/// binds a listener and hands it to [`axum::serve`].
pub fn app() -> Router {
    Router::new()
        .route("/healthz", get(healthz))
        .fallback(get(spa_fallback))
}

/// Handles `GET /healthz`, used by orchestrators/tests to probe liveness.
async fn healthz() -> &'static str {
    "ok"
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
pub async fn run(addr: &str) -> anyhow::Result<()> {
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!(%addr, "rhizz-server listening");
    axum::serve(listener, app()).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::header;
    use axum::http::{Request, StatusCode};
    use tower::ServiceExt as _;

    #[tokio::test]
    async fn healthz_returns_200_and_ok() {
        let response = app()
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
        let response = app()
            .oneshot(Request::builder().uri("/nope").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_content_type(&response, "text/html");
    }

    #[tokio::test]
    async fn root_serves_spa_shell() {
        let response = app()
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
        let response = app()
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
        let response = app()
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
        let response = app()
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
