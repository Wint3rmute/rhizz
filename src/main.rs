//! `rhizz` — a code-first Model-Based Systems Engineering (MBSE) tool.
//!
//! Systems are described in `.hcl` files which are parsed, validated,
//! scored for completeness, and rendered as Graphviz DOT diagrams.
#![deny(clippy::all)]
#![deny(missing_docs)]
#![deny(clippy::missing_docs_in_private_items)]
#![deny(warnings)]
/// Command-line interface definitions.
mod cli;
/// Graphviz DOT rendering.
mod dot;
/// Resolved model types and diagnostic definitions.
mod model;
/// HCL parsing and raw deserialization structs.
mod parse;
/// Name resolution and cross-reference pass.
mod resolve;
/// Completion scoring.
mod score;
/// Warning-level validation pass.
mod validate;

fn main() {
    println!("rhizz");
}
