//! `rhizz-server` — HTTP server library for the `rhizz web` subcommand.
//!
//! The server serves the compiled [`web`](https://github.com/wint3rmute/rhizz/tree/main/web)
//! frontend over HTTP and gives the browser-based virtual filesystem (VFS) a
//! place to keep its projects on disk: one directory of ordinary files per
//! project, so a data dir is a plain directory tree. No authentication or
//! authorization is implemented — the server assumes a trusted, public
//! environment.
#![deny(clippy::all)]
#![deny(missing_docs)]
#![deny(clippy::missing_docs_in_private_items)]
#![deny(warnings)]

/// HTTP server layer: router assembly and handlers.
pub mod server;

/// Signal handling for graceful shutdown.
pub mod signal;

/// Compile-time embedding of the web frontend.
pub mod assets;

/// Filesystem persistence for the VFS API: one directory per project.
pub mod storage;
