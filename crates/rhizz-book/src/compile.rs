//! In-process compilation of `` ```rhizz `` block bodies with `rhizz-core`.
//!
//! The Python preprocessor spawned the `rhizz` CLI per block; running in
//! the same process removes the binary-discovery, tempdir and timeout
//! machinery entirely while producing the exact same normalized verdicts.

use crate::normalize::{NormDiagnostic, NormalizedOutput, sort_diagnostics};
use rhizz_core::{CompileResult, Diagnostic, Source, score};
use serde_json::{Value, json};

/// Filename under which every book block is compiled (used for diagnostics).
pub const BLOCK_FILENAME: &str = "system.hcl";

/// Convert a core [`Diagnostic`] into its comparable form.
#[must_use]
pub fn to_normalized(diagnostic: &Diagnostic) -> NormDiagnostic {
    NormDiagnostic {
        code: diagnostic.code.to_string(),
        line: diagnostic.line,
        message: diagnostic.message.clone(),
    }
}

/// A block compile result: diagnostics in compiler emission order for the
/// HTML panels (matching the preprocessor's historical output), plus the
/// stably sorted form stored in `book.lock`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Verdict {
    /// Blocking diagnostics in emission order (panel rendering).
    pub errors: Vec<NormDiagnostic>,
    /// Non-blocking diagnostics in emission order (panel rendering).
    pub warnings: Vec<NormDiagnostic>,
    /// Completion score; present only when compilation produced a model.
    pub score: Option<Value>,
    /// Diagnostics sorted by `(code, line, message)` for `book.lock`.
    pub sorted: NormalizedOutput,
}

impl Verdict {
    /// Build a verdict, deriving the sorted form from the emission order.
    #[must_use]
    pub fn new(
        errors: Vec<NormDiagnostic>,
        warnings: Vec<NormDiagnostic>,
        score: Option<Value>,
    ) -> Self {
        let mut sorted_errors = errors.clone();
        let mut sorted_warnings = warnings.clone();
        sort_diagnostics(&mut sorted_errors);
        sort_diagnostics(&mut sorted_warnings);
        let sorted = NormalizedOutput {
            errors: sorted_errors,
            score: score.clone(),
            warnings: sorted_warnings,
        };
        Self {
            errors,
            warnings,
            score,
            sorted,
        }
    }
}

/// Normalize a compile result into a [`Verdict`].
///
/// The completion score is attached only when compilation produced a model
/// (mirroring `rhizz --json build`).
#[must_use]
pub fn normalize_result(result: &CompileResult) -> Verdict {
    let errors: Vec<NormDiagnostic> = result
        .diagnostics
        .iter()
        .filter(|diagnostic| diagnostic.is_error())
        .map(to_normalized)
        .collect();
    let warnings: Vec<NormDiagnostic> = result
        .diagnostics
        .iter()
        .filter(|diagnostic| diagnostic.is_warning())
        .map(to_normalized)
        .collect();

    let score_value = if result.model.is_some() && errors.is_empty() {
        result.model.as_ref().map(|model| score_json(&score(model)))
    } else {
        None
    };

    Verdict::new(errors, warnings, score_value)
}

/// Compile one `` ```rhizz `` block body.
#[must_use]
pub fn compile_body(body: &str) -> Verdict {
    let source = Source {
        filename: BLOCK_FILENAME.to_owned(),
        content: body.to_owned(),
    };
    let verdict = normalize_result(&rhizz_core::compile(std::slice::from_ref(&source)));
    tracing::info!(
        bytes = body.len(),
        errors = verdict.errors.len(),
        warnings = verdict.warnings.len(),
        scored = verdict.score.is_some(),
        "compiled rhizz block"
    );
    verdict
}

/// Build the JSON score object with the same shape as `rhizz --json build`
/// (keys inserted alphabetically, matching the historical lock writer).
#[must_use]
pub fn score_json(report: &rhizz_core::ScoreReport) -> Value {
    // Round to one decimal place for clean JSON output, like the CLI.
    let percent = (report.overall_percentage() * 10.0).round() / 10.0;
    json!({
        "components": {
            "complete": report.components.complete,
            "total": report.components.total(),
        },
        "connections": {
            "complete": report.connections.complete,
            "total": report.connections.total(),
        },
        "messages": {
            "complete": report.messages.complete,
            "total": report.messages.total(),
        },
        "overall": {
            "complete": report.overall_complete(),
            "percent": percent,
            "total": report.overall_total(),
        },
        "ports": {
            "complete": report.ports.complete,
            "total": report.ports.total(),
        },
        "system": report.project_name,
    })
}

#[cfg(test)]
mod tests {
    use super::{BLOCK_FILENAME, compile_body, normalize_result};
    use rhizz_core::{Source, compile};
    use serde_json::json;

    fn broken_block() -> String {
        [
            "project {",
            r#"  name = "greeter""#,
            "}",
            "",
            r#"system "app" {"#,
            r#"  connection "greet" {"#,
            r#"    from = "sender/out""#,
            r#"    to   = "receiver/in""#,
            "  }",
            "}",
        ]
        .join("\n")
    }

    #[test]
    fn broken_block_produces_errors_and_no_score() {
        let output = compile_body(&broken_block());
        assert_eq!(output.sorted.errors[0].code, "E011");
        assert!(output.score.is_none());
        assert!(output.sorted.errors[0].line.is_none());
    }

    #[test]
    fn broken_block_panel_order_matches_emission_order() {
        let output = compile_body(&broken_block());
        // Emission order, not sorted: 'sender' precedes 'receiver' (unsorted
        // message order) while the lock copy is sorted.
        assert!(output.errors[0].message.contains("sender"));
        assert!(output.sorted.errors[0].message.contains("receiver"));
    }

    #[test]
    fn valid_block_compiles_with_score() {
        let body = valid_model();
        let output = compile_body(&body);
        assert_eq!(output.sorted.errors, vec![]);
        assert_eq!(output.errors, vec![]);
        let score = output.score.as_ref().expect("valid model should be scored");
        assert_eq!(
            score.get("system").and_then(serde_json::Value::as_str),
            Some("demo")
        );
        assert_eq!(
            score
                .get("overall")
                .and_then(|v| v.get("percent"))
                .and_then(serde_json::Value::as_f64),
            Some(100.0)
        );
    }

    #[test]
    fn normalize_result_assigns_score_only_when_model_present() {
        let sources = [Source {
            filename: BLOCK_FILENAME.to_owned(),
            content: "this is not hcl at all".to_owned(),
        }];
        let result = compile(&sources);
        let output = normalize_result(&result);
        assert!(!output.sorted.errors.is_empty());
        assert!(output.sorted.errors.iter().all(|d| d.code == "E000"));
        assert!(output.score.is_none());
    }

    #[test]
    fn score_json_matches_cli_shape() {
        let output = compile_body(&valid_model());
        let score = output.score.as_ref().expect("should compile");
        let expected = json!({
            "components": {"complete": 3, "total": 3},
            "connections": {"complete": 1, "total": 1},
            "messages": {"complete": 1, "total": 1},
            "overall": {"complete": 8, "percent": 100.0, "total": 8},
            "ports": {"complete": 3, "total": 3},
            "system": "demo",
        });
        assert_eq!(score, &expected);
    }

    /// A model with definition + two instances + connection: compiles without
    /// errors and scores 100% (mirrors the drone example's shape).
    fn valid_model() -> String {
        [
            "project {",
            r#"  name = "demo""#,
            "}",
            "",
            r#"protocol "msg" {"#,
            r#"  description = "d""#,
            r#"  message "m" {"#,
            r#"    description = "d""#,
            r#"    field "id" {"#,
            r#"      description = "d""#,
            r#"      type = "string""#,
            "    }",
            "  }",
            "}",
            "",
            r#"component "a" {"#,
            r#"  description = "d""#,
            "  leaf = true",
            "",
            r#"  port "p" {"#,
            r#"    description = "d""#,
            r#"    protocol = "msg""#,
            "  }",
            "}",
            "",
            r#"system "app" {"#,
            r#"  description = "d""#,
            r#"  instance "a" { source = "a" }"#,
            r#"  instance "b" { source = "a" }"#,
            "",
            r#"  connection "link" {"#,
            r#"    description = "d""#,
            r#"    from = "a/p""#,
            r#"    to   = "b/p""#,
            "  }",
            "}",
        ]
        .join("\n")
    }
}
