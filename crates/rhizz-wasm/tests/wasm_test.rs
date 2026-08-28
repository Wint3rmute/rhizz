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
            content: r#"project {
  name    = "test"
  version = "0.1.0"
  authors = []
}"#
            .to_string(),
        },
        rhizz_core::Source {
            filename: "system.hcl".to_string(),
            content: r##"
                system "web" {
                    description = "Simple web system"
                    tags        = []
                    level       = 0

                    component "server" {
                        description = "HTTP server"
                        icon        = "server"
                        color       = "#00ff00"
                        border      = "dashed"
                        font        = "bold"
                        tags        = []
                        leaf        = true
                    }
                }
            "##
            .to_string(),
        },
    ]
}

#[wasm_bindgen_test]
fn compile_valid_sources_returns_no_errors() {
    let result = rhizz_wasm::CompileResultJS::compile(sources_to_js(&valid_sources()))
        .expect("compile_sources should not return a JsError");

    assert_eq!(result.error_count(), 0, "expected no errors");
    assert!(result.model().is_some(), "expected a model to be present");
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

    let model = result.model().expect("expected a model to be present");
    let comps = model.components();
    assert!(!comps.is_empty(), "expected at least one component");
    let server = comps
        .iter()
        .find(|c: &&rhizz_wasm::ComponentJS| c.label() == "server")
        .expect("expected component 'server'");
    assert!(server.leaf(), "server should be a leaf component");
    assert_eq!(server.description(), "HTTP server");
    assert_eq!(server.icon(), Some("server".to_string()));
    assert_eq!(server.color(), Some("#00ff00".to_string()));
    assert_eq!(server.border(), Some("dashed".to_string()));
    assert_eq!(server.font(), Some("bold".to_string()));
}

#[wasm_bindgen_test]
fn component_visual_attributes_default_to_none() {
    let result = rhizz_wasm::CompileResultJS::compile(sources_to_js(&[rhizz_core::Source {
        filename: "system.hcl".to_string(),
        content: r#"system "bare" {
    component "plain" {
        leaf = true
    }
}
"#
        .to_string(),
    }]))
    .expect("compile_sources should not return a JsError");

    let model = result.model().expect("expected a model to be present");
    let comps = model.components();
    let plain = comps
        .iter()
        .find(|c: &&rhizz_wasm::ComponentJS| c.label() == "plain")
        .expect("expected component 'plain'");
    assert_eq!(plain.color(), None);
    assert_eq!(plain.border(), None);
    assert_eq!(plain.font(), None);
}

#[wasm_bindgen_test]
fn score_returns_typed_wrapper() {
    let result = rhizz_wasm::CompileResultJS::compile(sources_to_js(&valid_sources()))
        .expect("compile_sources should not return a JsError");

    let model = result.model().expect("expected a model to be present");
    let score = model.score();
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

    let model = result.model().expect("expected a model to be present");
    let project = model.project();
    assert_eq!(project.name(), "test");
    assert_eq!(project.version(), "0.1.0");
}

#[wasm_bindgen_test]
fn model_is_none_on_error() {
    let sources = vec![rhizz_core::Source {
        filename: "bad.hcl".to_string(),
        content: "this is not valid HCL {{{{".to_string(),
    }];

    let result = rhizz_wasm::CompileResultJS::compile(sources_to_js(&sources))
        .expect("compile_sources should not return a JsError");

    assert!(
        result.model().is_none(),
        "expected no model when compilation failed"
    );
}

#[wasm_bindgen_test]
fn protocols_and_ports_return_typed_wrappers() {
    let sources = vec![rhizz_core::Source {
        filename: "main.hcl".to_string(),
        content: r#"
                protocol "http" {
                    description = "HTTP protocol"
                    tags        = ["web"]
                    roles       = ["provider", "consumer"]

                    message "request" {
                        field "url" { type = "string" }
                    }
                }

                system "web" {
                    component "server" {
                        leaf = true
                        port "api" {
                            protocol = "http"
                            role     = "provider"
                            external = true
                            required = false
                        }
                    }
                }
            "#
        .to_string(),
    }];

    let result = rhizz_wasm::CompileResultJS::compile(sources_to_js(&sources))
        .expect("compile should succeed");
    assert_eq!(result.error_count(), 0);

    let model = result.model().expect("model should be present");

    let protos = model.protocols();
    assert_eq!(protos.len(), 1);
    assert_eq!(protos[0].label(), "http");
    assert_eq!(protos[0].description(), "HTTP protocol");
    assert_eq!(protos[0].tags(), vec!["web"]);
    assert_eq!(protos[0].roles(), vec!["provider", "consumer"]);

    let ports = model.ports();
    assert_eq!(ports.len(), 1);
    assert_eq!(ports[0].label(), "api");
    assert_eq!(ports[0].protocol(), "http");
    assert_eq!(ports[0].role(), Some("provider".to_string()));
    assert!(ports[0].external());
    assert!(!ports[0].required());
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
    assert!(result.model().is_none());
}

#[wasm_bindgen_test]
fn compile_sources_rejects_non_array_input() {
    let bad = JsValue::from_str("not an array");

    let err = rhizz_wasm::CompileResultJS::compile(bad);
    assert!(err.is_err(), "should return a JsError for non-array input");
}

#[wasm_bindgen_test]
fn model_serialization_via_wasm() {
    let result = rhizz_wasm::CompileResultJS::compile(sources_to_js(&valid_sources()))
        .expect("compile_sources should not return a JsError");

    let model = result.model().expect("expected model");
    let hcl = model.to_hcl();
    assert!(hcl.contains("system \"web\""));
    assert!(hcl.contains("component \"server\""));

    let top_level_hcl = rhizz_wasm::serialize_model(&model);
    assert_eq!(hcl, top_level_hcl);

    // JSON round-trip
    let json = model.to_json().expect("to_json should succeed");
    let model_from_json = rhizz_wasm::ModelJS::from_json(&json).expect("from_json should succeed");
    assert_eq!(model.to_hcl(), model_from_json.to_hcl());
}

#[wasm_bindgen_test]
fn get_example_projects_returns_all_embedded_examples() {
    let js_val = rhizz_wasm::get_example_projects().expect("should return examples");
    let examples: Vec<rhizz_wasm::ExampleProjectJS> =
        serde_wasm_bindgen::from_value(js_val).expect("should deserialize examples");

    assert!(examples.len() >= 6);
    let apollo = examples
        .iter()
        .find(|e| e.id == "apollo-11")
        .expect("apollo-11 should exist");
    assert_eq!(apollo.name, "Apollo 11 Mission Stack");
    assert!(!apollo.files.is_empty());
}

#[wasm_bindgen_test]
fn views_serialization_and_parsing_via_wasm() {
    let views_hcl = r#"view "main" {
  description = "Main diagram"
  system      = "web"

  filter {
    max_level = 1
  }

  output {
    filename = "main.dot"
    rankdir  = "TB"
  }

  node "server" {
    x          = 150
    y          = 220
    width      = 120
    height     = 80
    text_align = "center"
  }
}
"#;

    let parsed_js =
        rhizz_wasm::parse_views(views_hcl).expect("parse_views via WASM should succeed");
    let serialized_hcl =
        rhizz_wasm::serialize_views(parsed_js).expect("serialize_views via WASM should succeed");

    assert!(serialized_hcl.contains("view \"main\""));
    assert!(serialized_hcl.contains("node \"server\""));
    assert!(serialized_hcl.contains("x          = 150"));
}
