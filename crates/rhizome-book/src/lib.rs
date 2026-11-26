//! `rhizome-book` — the mdBook preprocessor for `` ```rhizome `` code blocks.
//!
//! Replaces the historical Python preprocessor: every fenced `` ```rhizome ``
//! block is compiled in-process with `rhizome-core`, replaced by a live
//! `/book-example` embed carrying the block as a single-file project, and
//! each block's input→output trace is verified against `book/book.lock` so
//! documentation cannot silently drift from the compiler.

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
