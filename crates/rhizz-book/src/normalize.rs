//! Deterministic normalization of compiler output for `book.lock` comparison.
//!
//! The historical Python lock kept only `{code, line?, message}` per
//! diagnostic (dropping the `file` path, which embeds a tempdir name that
//! legitimately changes between runs) and sorted diagnostics so compiler
//! reordering cannot cause spurious lock mismatches. This module preserves
//! exactly that comparable form.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// One diagnostic in its comparable form.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NormDiagnostic {
    /// Stable diagnostic code (e.g. `W005`).
    pub code: String,
    /// 1-based source line; omitted when the compiler could not attribute one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<u32>,
    /// Human-readable message.
    pub message: String,
}

/// The comparable compiler verdict stored in `book.lock` and rendered into
/// the HTML panel.
///
/// Field order matches the historical Python lock writer's `sort_keys`
/// output, so regenerated lock files stay familiar.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NormalizedOutput {
    /// Blocking diagnostics.
    pub errors: Vec<NormDiagnostic>,
    /// Completion score; present only when compilation produced a model.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub score: Option<Value>,
    /// Non-blocking diagnostics.
    pub warnings: Vec<NormDiagnostic>,
}

/// Ordering key mirroring Python's `(code, line or -1, message)` sort.
#[must_use]
pub fn diag_sort_key(diagnostic: &NormDiagnostic) -> (String, i64, String) {
    let line = diagnostic.line.map_or(-1, i64::from);
    (diagnostic.code.clone(), line, diagnostic.message.clone())
}

/// Sort diagnostics stably into the canonical `book.lock` order.
pub fn sort_diagnostics(diagnostics: &mut [NormDiagnostic]) {
    diagnostics.sort_by_key(diag_sort_key);
}

#[cfg(test)]
mod tests {
    use super::{NormDiagnostic, NormalizedOutput, diag_sort_key, sort_diagnostics};
    use serde_json::json;

    fn sample_output() -> NormalizedOutput {
        NormalizedOutput {
            errors: vec![
                NormDiagnostic {
                    code: "E011".to_owned(),
                    line: None,
                    message: "connection 'greet' references undefined component 'sender' in 'from'"
                        .to_owned(),
                },
                NormDiagnostic {
                    code: "E011".to_owned(),
                    line: Some(12),
                    message: "connection 'greet' references undefined component 'receiver' in 'to'"
                        .to_owned(),
                },
            ],
            warnings: vec![NormDiagnostic {
                code: "W005".to_owned(),
                line: None,
                message: "connection 'greet' has 'from' and 'to' pointing to the same component"
                    .to_owned(),
            }],
            score: None,
        }
    }

    #[test]
    fn sorting_puts_line_less_diagnostics_first() {
        let mut out = sample_output();
        sort_diagnostics(&mut out.errors);
        assert_eq!(
            out.errors[0].message,
            "connection 'greet' references undefined component 'sender' in 'from'"
        );
        assert_eq!(out.errors[1].line, Some(12));
    }

    #[test]
    fn sorting_is_stable_across_reordered_input() {
        let mut a = NormalizedOutput {
            errors: vec![],
            warnings: vec![
                NormDiagnostic {
                    code: "W002".to_owned(),
                    line: None,
                    message: "x".to_owned(),
                },
                NormDiagnostic {
                    code: "W001".to_owned(),
                    line: None,
                    message: "y".to_owned(),
                },
            ],
            score: None,
        };
        let mut b = NormalizedOutput {
            errors: vec![],
            warnings: vec![
                NormDiagnostic {
                    code: "W001".to_owned(),
                    line: None,
                    message: "y".to_owned(),
                },
                NormDiagnostic {
                    code: "W002".to_owned(),
                    line: None,
                    message: "x".to_owned(),
                },
            ],
            score: None,
        };
        sort_diagnostics(&mut a.warnings);
        sort_diagnostics(&mut b.warnings);
        assert_eq!(a, b);
    }

    #[test]
    fn sort_key_orders_by_code_then_line_then_message() {
        let base = NormDiagnostic {
            code: "W001".to_owned(),
            line: None,
            message: "m".to_owned(),
        };
        let other_code = NormDiagnostic {
            code: "W002".to_owned(),
            line: None,
            message: "m".to_owned(),
        };
        let with_line = NormDiagnostic {
            code: "W001".to_owned(),
            line: Some(3),
            message: "m".to_owned(),
        };
        let other_message = NormDiagnostic {
            code: "W001".to_owned(),
            line: None,
            message: "n".to_owned(),
        };
        assert!(diag_sort_key(&base) < diag_sort_key(&other_code));
        assert!(diag_sort_key(&base) < diag_sort_key(&with_line));
        assert!(diag_sort_key(&base) < diag_sort_key(&other_message));
    }

    #[test]
    fn serialization_omits_null_line_and_keeps_declared_order() {
        let out = NormalizedOutput {
            errors: vec![NormDiagnostic {
                code: "E001".to_owned(),
                line: None,
                message: "m".to_owned(),
            }],
            warnings: vec![],
            score: None,
        };
        let text = serde_json::to_string(&out).unwrap_or_default();
        assert!(text.contains("\"errors\":[{\"code\":\"E001\",\"message\":\"m\"}]"));
        assert!(!text.contains("\"line\""));
    }

    #[test]
    fn serialization_is_deterministic() {
        let first = serde_json::to_string(&sample_output()).unwrap_or_default();
        let second = serde_json::to_string(&sample_output()).unwrap_or_default();
        assert_eq!(first, second);
    }

    #[test]
    fn score_passthrough_when_present() {
        let mut out = sample_output();
        out.score =
            Some(json!({"overall": {"percent": 100.0}, "ports": {"complete": 4, "total": 4}}));
        let text = serde_json::to_string(&out).expect("serialize output");
        let parsed: NormalizedOutput =
            serde_json::from_str(&text).expect("output json should parse");
        assert_eq!(
            parsed.score,
            Some(json!({"overall": {"percent": 100.0}, "ports": {"complete": 4, "total": 4}}))
        );
    }

    #[test]
    fn no_path_may_leak_into_serialized_output() {
        let text = serde_json::to_string(&sample_output()).unwrap_or_default();
        assert!(!text.contains("rhizz-book-"));
    }
}
