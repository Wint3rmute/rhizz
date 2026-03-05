//! `rhizz-cli` — the command-line interface for `rhizz`.
//!
//! This crate wires together [`rhizz_core`] (parsing, resolution, validation,
//! scoring) and [`rhizz_dot`] (DOT rendering) into an end-user CLI.
#![deny(clippy::all)]
#![deny(missing_docs)]
#![deny(clippy::missing_docs_in_private_items)]
#![deny(warnings)]

/// Command-line interface: argument parsing, pipeline orchestration, and output
/// formatting.
pub mod cli;
