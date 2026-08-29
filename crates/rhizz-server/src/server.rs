//! HTTP server layer built on axum.
//!
//! This module owns the axum router: every route rhizz-server exposes —
//! currently just the `/healthz` sample route — is assembled here, so
//! handlers can be exercised in-process with `tower::ServiceExt::oneshot`
//! without binding a socket.

use axum::{Router, routing::get};

/// Builds the complete axum router for the server.
///
/// Keep this as the single place that registers routes; the binary only
/// binds a listener and hands it to [`axum::serve`].
pub fn app() -> Router {
    Router::new().route("/healthz", get(healthz))
}

/// Handles `GET /healthz`, used by orchestrators/tests to probe liveness.
async fn healthz() -> &'static str {
    "ok"
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
    async fn unknown_route_returns_404() {
        let response = app()
            .oneshot(Request::builder().uri("/nope").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }
}
