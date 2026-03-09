//! `rhizz-wasm` — WebAssembly bindings for `rhizz-core`.
//!
//! Exposes a single [`compile_sources`] function that accepts a JSON array of
//! `{ "filename": "...", "content": "..." }` objects and returns a
//! JSON-serialised [`rhizz_core::CompileResult`].

#![deny(clippy::all)]

use wasm_bindgen::prelude::*;

/// Compile one or more HCL sources and return the result as JSON.
///
/// # Arguments
/// * `sources_json` – a JSON array of objects with `filename` and `content` fields.
///
/// # Returns
/// A JSON string of the form:
/// ```json
/// { "model": <Model | null>, "diagnostics": [...] }
/// ```
///
/// # Errors
/// Returns a [`JsError`] if `sources_json` is not valid JSON or cannot be
/// deserialised into `Vec<Source>`.
#[wasm_bindgen]
pub fn compile_sources(sources_json: &str) -> Result<String, JsError> {
    let sources: Vec<rhizz_core::Source> =
        serde_json::from_str(sources_json).map_err(|e| JsError::new(&e.to_string()))?;
    let result = rhizz_core::compile(&sources);
    serde_json::to_string(&result).map_err(|e| JsError::new(&e.to_string()))
}
