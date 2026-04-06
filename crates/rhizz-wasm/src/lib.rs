//! `rhizz-wasm` — WebAssembly bindings for `rhizz-core`.

#![deny(clippy::all)]

use wasm_bindgen::prelude::*;

/// A compiled result exposed as a JS class with callable Rust methods.
///
/// Construct with [`CompileResultJS::compile`], then call [`CompileResultJS::model`],
/// [`CompileResultJS::diagnostics`], or [`CompileResultJS::has_model`] directly
/// from JavaScript without round-tripping through JSON.
///
/// ```js
/// const result = CompileResultJS.compile(sources);
/// if (result.has_model()) {
///     const model = result.model();
/// }
/// const diags = result.diagnostics();
/// ```
#[wasm_bindgen]
pub struct CompileResultJS {
    inner: rhizz_core::CompileResult,
}

#[wasm_bindgen]
impl CompileResultJS {
    /// Compile one or more HCL sources and return a [`CompileResultJS`].
    ///
    /// # Arguments
    /// * `sources` – a JS array of `{ filename: string, content: string }` objects.
    ///
    /// # Errors
    /// Returns a [`JsError`] if `sources` cannot be deserialised.
    pub fn compile(sources: JsValue) -> Result<CompileResultJS, JsError> {
        let sources: Vec<rhizz_core::Source> =
            serde_wasm_bindgen::from_value(sources).map_err(|e| JsError::new(&e.to_string()))?;
        Ok(CompileResultJS {
            inner: rhizz_core::compile(&sources),
        })
    }

    /// Returns `true` if compilation produced a model (i.e. no hard errors).
    pub fn has_model(&self) -> bool {
        self.inner.model.is_some()
    }

    /// Returns the compiled [`rhizz_core::Model`] as a JS object, or `null` if there were hard errors.
    ///
    /// # Errors
    /// Returns a [`JsError`] if serialisation fails.
    pub fn model(&self) -> Result<JsValue, JsError> {
        serde_wasm_bindgen::to_value(&self.inner.model).map_err(|e| JsError::new(&e.to_string()))
    }

    /// Returns all diagnostics (errors and warnings) as a JS array.
    ///
    /// # Errors
    /// Returns a [`JsError`] if serialisation fails.
    pub fn diagnostics(&self) -> Result<JsValue, JsError> {
        serde_wasm_bindgen::to_value(&self.inner.diagnostics)
            .map_err(|e| JsError::new(&e.to_string()))
    }
}
