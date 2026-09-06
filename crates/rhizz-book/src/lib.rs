//! `rhizz-book` — the mdBook preprocessor for `` ```rhizz `` code blocks.
//!
//! Replaces the historical Python preprocessor: every fenced `` ```rhizz ``
//! block is compiled in-process with `rhizz-core`, replaced by the original
//! HCL (as `` ```hcl ``) plus an HTML verdict panel, and each block's input→
//! output trace is verified against `book/book.lock` so documentation cannot
//! silently drift from the compiler.

#![deny(clippy::all)]
#![deny(missing_docs)]
#![deny(warnings)]

pub mod blocks;
pub mod compile;
pub mod lock;
pub mod normalize;
pub mod project;
pub mod protocol;
pub mod render;
pub mod transform;
