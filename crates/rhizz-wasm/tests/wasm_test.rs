//! Wasm smoke tests – run with:
//!   wasm-pack test --node crates/rhizz-wasm

use wasm_bindgen_test::wasm_bindgen_test;

#[wasm_bindgen_test]
fn compile_valid_sources_returns_no_errors() {
    let sources = serde_json::json!([
        {
            "filename": "project.hcl",
            "content": r#"project { name = "test" version = "0.1.0" authors = [] }"#
        },
        {
            "filename": "system.hcl",
            "content": r#"
                system "web" {
                    description = "Simple web system"
                    tags        = []
                    level       = 0

                    component "server" {
                        description = "HTTP server"
                        tags        = []
                        leaf        = true
                    }
                }
            "#
        }
    ]);

    let json = rhizz_wasm::compile_sources(&sources.to_string())
        .expect("compile_sources should not return a JsError");

    let result: serde_json::Value =
        serde_json::from_str(&json).expect("result should be valid JSON");

    let diagnostics = result["diagnostics"].as_array().expect("diagnostics array");
    let errors: Vec<_> = diagnostics
        .iter()
        .filter(|d| d["level"].as_str() == Some("Error"))
        .collect();

    assert!(errors.is_empty(), "expected no errors, got: {errors:?}");
    assert!(
        result["model"].is_object(),
        "expected a model to be present"
    );
}

#[wasm_bindgen_test]
fn compile_invalid_hcl_returns_error_diagnostic() {
    let sources = serde_json::json!([
        { "filename": "bad.hcl", "content": "this is not valid HCL {{{{" }
    ]);

    let json = rhizz_wasm::compile_sources(&sources.to_string())
        .expect("compile_sources should not panic on bad input");

    let result: serde_json::Value = serde_json::from_str(&json).unwrap();
    let diagnostics = result["diagnostics"].as_array().unwrap();
    assert!(
        !diagnostics.is_empty(),
        "expected at least one error diagnostic"
    );
    assert_eq!(result["model"], serde_json::Value::Null);
}

#[wasm_bindgen_test]
fn compile_sources_rejects_bad_json() {
    let err = rhizz_wasm::compile_sources("not json at all");
    assert!(err.is_err(), "should return a JsError for malformed JSON");
}
