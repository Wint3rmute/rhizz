//! Signal handling for graceful shutdown.
//!
//! The server often runs as PID 1 inside a container. The kernel does not
//! apply default signal dispositions to PID 1, so SIGINT / SIGTERM would be
//! silently dropped unless we install our own handler — this is why `docker
//! run` did not react to Ctrl-C. We therefore wait on both signals and hand
//! the resulting future to axum's graceful shutdown.

use std::future::Future;
use std::pin::Pin;

use tracing::info;

/// Returns a future that resolves once SIGINT or SIGTERM is received,
/// logging which signal triggered the shutdown.
///
/// If installing the SIGTERM handler fails (practically impossible on Unix),
/// shutdown still waits for SIGINT rather than panicking.
#[must_use]
pub fn shutdown_signal() -> Pin<Box<dyn Future<Output = ()> + Send + 'static>> {
    Box::pin(async {
        let sigint = tokio::signal::ctrl_c();
        let sigterm = async {
            use tokio::signal::unix::SignalKind;
            let mut stream = match tokio::signal::unix::signal(SignalKind::terminate()) {
                Ok(stream) => stream,
                Err(err) => {
                    tracing::error!(
                        %err,
                        "could not install SIGTERM handler; only SIGINT will shut down"
                    );
                    // Never resolve; SIGINT still works.
                    std::future::pending::<()>().await;
                    return;
                }
            };
            stream.recv().await;
        };

        tokio::select! {
            _ = sigint => info!("received SIGINT, shutting down gracefully"),
            () = sigterm => {
                info!("received SIGTERM, shutting down gracefully");
            },
        }
    })
}
