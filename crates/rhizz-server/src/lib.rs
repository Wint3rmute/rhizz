//! `rhizz-server` — a standalone HTTP server for `rhizz`.
//!
//! The server serves the compiled [`web`](https://github.com/wint3rmute/rhizz/tree/main/web)
//! frontend over HTTP and provides a small persistence API that the
//! browser-based virtual filesystem (VFS) can use to store its state on
//! disk. No authentication or authorization is implemented — the server
//! assumes a trusted, public environment.
#![deny(clippy::all)]
#![deny(missing_docs)]
#![deny(clippy::missing_docs_in_private_items)]
#![deny(warnings)]

/// HTTP server layer: router assembly and handlers.
pub mod server;

/// Compile-time embedding of the web frontend.
pub mod assets;
