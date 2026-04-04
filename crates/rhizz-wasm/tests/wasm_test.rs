//! Wasm smoke tests – run with:
//!   wasm-pack test --node crates/rhizz-wasm

use wasm_bindgen::JsValue;
use wasm_bindgen_test::wasm_bindgen_test;

fn sources_to_js(sources: &[rhizz_core::Source]) -> JsValue {
    serde_wasm_bindgen::to_value(sources).expect("sources serialization should not fail")
}

fn result_to_json(val: JsValue) -> serde_json::Value {
    serde_wasm_bindgen::from_value(val).expect("result deserialization should not fail")
}

#[wasm_bindgen_test]
fn compile_valid_sources_returns_no_errors() {
    let sources = vec![
        rhizz_core::Source {
            filename: "project.hcl".to_string(),
            content: r#"project { name = "test" version = "0.1.0" authors = [] }"#.to_string(),
        },
        rhizz_core::Source {
            filename: "system.hcl".to_string(),
            content: r#"
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
            .to_string(),
        },
    ];

    let result = result_to_json(
        rhizz_wasm::CompileResultJS::compile(sources_to_js(&sources))
            .expect("compile_sources should not return a JsError")
            .into(),
    );

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
    let sources = vec![rhizz_core::Source {
        filename: "bad.hcl".to_string(),
        content: "this is not valid HCL {{{{".to_string(),
    }];

    let result = result_to_json(
        rhizz_wasm::CompileResultJS::compile(sources_to_js(&sources))
            .expect("compile_sources should not return a JsError")
            .into(),
    );

    let diagnostics = result["diagnostics"].as_array().unwrap();
    assert!(
        !diagnostics.is_empty(),
        "expected at least one error diagnostic"
    );
    assert_eq!(result["model"], serde_json::Value::Null);
}

#[wasm_bindgen_test]
fn compile_sources_rejects_non_array_input() {
    let bad = JsValue::from_str("not an array");

    let err = rhizz_wasm::CompileResultJS::compile(bad);
    assert!(err.is_err(), "should return a JsError for non-array input");
}
