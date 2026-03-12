//! `rhizz-wasm` — WebAssembly bindings for `rhizz-core`.
//!
//! Exposes a single [`compile_sources`] function that accepts a JS array of
//! `{ filename, content }` source objects and returns a [`rhizz_core::CompileResult`]
//! as a native JS object — no JSON stringification required on either side.

#![deny(clippy::all)]

use wasm_bindgen::prelude::*;

/// Compile one or more HCL sources.
///
/// # Arguments
/// * `sources` – a JS array of `{ filename: string, content: string }` objects.
///
/// # Returns
/// A JS object of the form `{ model: Model | null, diagnostics: Diagnostic[] }`.
///
/// # Errors
/// Returns a [`JsError`] if `sources` cannot be deserialised into `Vec<Source>`.
#[wasm_bindgen]
pub fn compile_sources(sources: JsValue) -> Result<JsValue, JsError> {
    let sources: Vec<rhizz_core::Source> =
        serde_wasm_bindgen::from_value(sources).map_err(|e| JsError::new(&e.to_string()))?;
    let result = rhizz_core::compile(&sources);
    serde_wasm_bindgen::to_value(&result).map_err(|e| JsError::new(&e.to_string()))
}
