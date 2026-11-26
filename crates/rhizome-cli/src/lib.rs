//! `rhizome-cli` — the command-line interface for `rhizome`.
//!
//! This crate wires together [`rhizome_core`] (parsing, resolution, validation,
//! scoring) into an end-user CLI.
#![deny(clippy::all)]
#![deny(missing_docs)]
#![deny(clippy::missing_docs_in_private_items)]
#![deny(warnings)]

/// Command-line interface: argument parsing, pipeline orchestration, and output
/// formatting.
pub mod cli;
