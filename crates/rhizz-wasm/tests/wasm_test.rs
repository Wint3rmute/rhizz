//! Wasm smoke tests – run with:
//!   wasm-pack test --node crates/rhizz-wasm

use wasm_bindgen::JsValue;
use wasm_bindgen_test::wasm_bindgen_test;

fn sources_to_js(sources: &[rhizz_core::Source]) -> JsValue {
    serde_wasm_bindgen::to_value(sources).expect("sources serialization should not fail")
}

fn valid_sources() -> Vec<rhizz_core::Source> {
    vec![
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
    ]
}

#[wasm_bindgen_test]
fn compile_valid_sources_returns_no_errors() {
    let result = rhizz_wasm::CompileResultJS::compile(sources_to_js(&valid_sources()))
        .expect("compile_sources should not return a JsError");

    assert_eq!(result.error_count(), 0, "expected no errors");
    assert!(result.has_model(), "expected a model to be present");
}

#[wasm_bindgen_test]
fn diagnostics_returns_typed_wrappers() {
    let result = rhizz_wasm::CompileResultJS::compile(sources_to_js(&valid_sources()))
        .expect("compile_sources should not return a JsError");

    let diags = result.diagnostics();
    // Valid sources should produce no error diagnostics.
    for d in &diags {
        assert_ne!(d.level(), "Error", "unexpected error: {}", d.message());
    }
}

#[wasm_bindgen_test]
fn components_returns_typed_wrappers() {
    let result = rhizz_wasm::CompileResultJS::compile(sources_to_js(&valid_sources()))
        .expect("compile_sources should not return a JsError");

    let comps = result.components();
    assert!(!comps.is_empty(), "expected at least one component");
    let server = comps.iter().find(|c| c.label() == "server");
    assert!(server.is_some(), "expected component 'server'");
    let server = server.unwrap();
    assert!(server.leaf(), "server should be a leaf component");
    assert_eq!(server.description(), "HTTP server");
}

#[wasm_bindgen_test]
fn score_returns_typed_wrapper() {
    let result = rhizz_wasm::CompileResultJS::compile(sources_to_js(&valid_sources()))
        .expect("compile_sources should not return a JsError");

    let score = result
        .score()
        .expect("score should be present for valid model");
    assert_eq!(score.project_name(), "test");
    // overall_percentage is a f64 in [0, 100]
    let pct = score.overall_percentage();
    assert!(
        (0.0..=100.0).contains(&pct),
        "overall_percentage out of range: {pct}"
    );
}

#[wasm_bindgen_test]
fn project_returns_typed_wrapper() {
    let result = rhizz_wasm::CompileResultJS::compile(sources_to_js(&valid_sources()))
        .expect("compile_sources should not return a JsError");

    let project = result
        .project()
        .expect("project should be present for valid model");
    assert_eq!(project.name(), "test");
    assert_eq!(project.version(), "0.1.0");
}

#[wasm_bindgen_test]
fn components_returns_empty_vec_on_error() {
    let sources = vec![rhizz_core::Source {
        filename: "bad.hcl".to_string(),
        content: "this is not valid HCL {{{{".to_string(),
    }];

    let result = rhizz_wasm::CompileResultJS::compile(sources_to_js(&sources))
        .expect("compile_sources should not return a JsError");

    assert!(!result.has_model());
    assert!(
        result.components().is_empty(),
        "expected empty components when model is absent"
    );
    assert!(
        result.score().is_none(),
        "expected no score when model is absent"
    );
    assert!(
        result.project().is_none(),
        "expected no project when model is absent"
    );
}

#[wasm_bindgen_test]
fn compile_invalid_hcl_returns_error_diagnostic() {
    let sources = vec![rhizz_core::Source {
        filename: "bad.hcl".to_string(),
        content: "this is not valid HCL {{{{".to_string(),
    }];

    let result = rhizz_wasm::CompileResultJS::compile(sources_to_js(&sources))
        .expect("compile_sources should not return a JsError");

    assert!(
        result.error_count() > 0,
        "expected at least one error diagnostic"
    );
    assert!(!result.has_model());
}

#[wasm_bindgen_test]
fn compile_sources_rejects_non_array_input() {
    let bad = JsValue::from_str("not an array");

    let err = rhizz_wasm::CompileResultJS::compile(bad);
    assert!(err.is_err(), "should return a JsError for non-array input");
}
