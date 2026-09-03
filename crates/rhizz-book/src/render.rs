//! HTML panels rendered after each `` ```rhizz `` block.
//!
//! The HTML mirrors the historical Python preprocessor byte-for-byte: the
//! same class names (`rhizz-diag`, `rhizz-ok`, …), unicode symbols (✓/⚠/✗),
//! em dash separators and score stats, so `book/css/rhizz.css` keeps styling.

use crate::compile::Verdict;
use crate::normalize::NormDiagnostic;
use serde_json::Value;

/// Panel shown for `` ```rhizz,ignore `` blocks (code kept, not compiled).
pub const IGNORE_PANEL: &str = "<div class=\"rhizz-diag rhizz-ignore\"><div class=\"rhizz-head\">Not compiled in this book</div></div>";

/// Escape text for HTML, mirroring Python's `html.escape(quote=True)`.
#[must_use]
pub fn esc(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for ch in text.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#x27;"),
            _ => out.push(ch),
        }
    }
    out
}

/// Pluralize a count like Python's `f"{n} {word}" + ("" if n == 1 else "s")`.
#[must_use]
pub fn plural(count: usize, word: &str) -> String {
    let suffix = if count == 1 { "" } else { "s" };
    format!("{count} {word}{suffix}")
}

/// Render one diagnostic as a list item with its code and message.
#[must_use]
pub fn diagnostic_item(diagnostic: &NormDiagnostic) -> String {
    let location = diagnostic.line.map_or_else(String::new, |line| {
        format!(" <span class=\"rhizz-loc\">(line {line})</span>")
    });
    format!(
        "<li><span class=\"rhizz-code\">{}</span>\u{2014} {}{location}</li>",
        esc(&diagnostic.code),
        esc(&diagnostic.message)
    )
}

/// Render the score statistics list (components / ports / connections /
/// messages / overall).
#[must_use]
pub fn stats_html(score: Option<&Value>) -> String {
    let Some(score) = score else {
        return String::new();
    };
    let mut items: Vec<String> = Vec::new();
    for (category, label) in [
        ("components", "Components"),
        ("ports", "Ports"),
        ("connections", "Connections"),
        ("messages", "Messages"),
    ] {
        let Some(category_value) = score.get(category) else {
            continue;
        };
        let complete = category_value
            .get("complete")
            .and_then(Value::as_u64)
            .unwrap_or(0);
        let total = category_value
            .get("total")
            .and_then(Value::as_u64)
            .unwrap_or(0);
        items.push(format!(
            "<li class=\"rhizz-stat\"><span>{label}</span><b>{complete}/{total}</b></li>"
        ));
    }
    let overall = score
        .get("overall")
        .and_then(|overall| overall.get("percent"))
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    format!(
        "<ul class=\"rhizz-stats\">{}<li class=\"rhizz-stat\"><span>Overall</span><b>{overall:.1}%</b></li></ul>",
        items.concat()
    )
}

/// Render the verdict panel for one compiled block.
///
/// Panels show diagnostics in compiler emission order, matching the output
/// the historical Python preprocessor produced; `book.lock` keeps the
/// stably sorted form instead.
#[must_use]
pub fn panel_html(output: &Verdict) -> String {
    if !output.errors.is_empty() {
        let head = format!(
            "\u{2717} {}, {} \u{2014} no score (compilation failed)",
            plural(output.errors.len(), "error"),
            plural(output.warnings.len(), "warning")
        );
        let mut error_items = String::new();
        for error in &output.errors {
            error_items.push_str(&diagnostic_item(error));
        }
        let mut warn_block = String::new();
        if !output.warnings.is_empty() {
            warn_block.push_str("<ul class=\"rhizz-diagnostics rhizz-warnings\">");
            for warning in &output.warnings {
                warn_block.push_str(&diagnostic_item(warning));
            }
            warn_block.push_str("</ul>");
        }
        format!(
            "<div class=\"rhizz-diag rhizz-error\"><div class=\"rhizz-head\">{head}</div>\
<ul class=\"rhizz-diagnostics rhizz-errors\">{error_items}</ul>{warn_block}</div>"
        )
    } else if !output.warnings.is_empty() {
        let count = plural(output.warnings.len(), "warning");
        let percent = output
            .score
            .as_ref()
            .and_then(|score| score.get("overall"))
            .and_then(|overall| overall.get("percent"))
            .and_then(Value::as_f64);
        let head = percent.map_or_else(
            || format!("\u{26a0} {count} \u{2014} no completion score produced"),
            |percent| format!("\u{26a0} {count} \u{2014} model completes at {percent:.1}%"),
        );
        let mut items = String::new();
        for warning in &output.warnings {
            items.push_str(&diagnostic_item(warning));
        }
        format!(
            "<div class=\"rhizz-diag rhizz-warn\"><div class=\"rhizz-head\">{head}</div>\
<ul class=\"rhizz-diagnostics rhizz-warnings\">{items}</ul>{}</div>",
            stats_html(output.score.as_ref())
        )
    } else {
        format!(
            "<div class=\"rhizz-diag rhizz-ok\"><div class=\"rhizz-head\">\u{2713} No errors, no warnings</div>{}</div>",
            stats_html(output.score.as_ref())
        )
    }
}

/// Panel shown when a compile result is missing (defensive; the in-process
/// compiler always produces one).
#[must_use]
pub fn tool_error_panel(message: &str) -> String {
    format!(
        "<div class=\"rhizz-diag rhizz-tool\"><div class=\"rhizz-head\">\u{26a0} Compiler unavailable</div><p class=\"rhizz-msg\">{}</p></div>",
        esc(message)
    )
}

#[cfg(test)]
mod tests {
    use super::{
        IGNORE_PANEL, diagnostic_item, esc, panel_html, plural, stats_html, tool_error_panel,
    };
    use crate::compile::Verdict;
    use crate::normalize::NormDiagnostic;
    use serde_json::json;

    #[test]
    fn esc_escapes_all_five_html_chars() {
        assert_eq!(esc("a&b<c>d\"e'f"), "a&amp;b&lt;c&gt;d&quot;e&#x27;f");
        assert_eq!(esc("plain text"), "plain text");
    }

    #[test]
    fn plural_handles_one_and_many() {
        assert_eq!(plural(1, "warning"), "1 warning");
        assert_eq!(plural(2, "warning"), "2 warnings");
        assert_eq!(plural(0, "error"), "0 errors");
    }

    #[test]
    fn diagnostic_item_renders_with_and_without_line() {
        let item = diagnostic_item(&NormDiagnostic {
            code: "W005".to_owned(),
            line: Some(3),
            message: "msg <x>".to_owned(),
        });
        assert!(item.contains("class=\"rhizz-code\">W005</span>"));
        assert!(item.contains("\u{2014} msg &lt;x&gt;"));
        assert!(item.contains("<span class=\"rhizz-loc\">(line 3)</span>"));

        let no_line = diagnostic_item(&NormDiagnostic {
            code: "E001".to_owned(),
            line: None,
            message: "m".to_owned(),
        });
        assert!(!no_line.contains("rhizz-loc"));
    }

    #[test]
    fn stats_html_render_all_categories_and_overall() {
        let score = json!({
            "components": {"complete": 1, "total": 2},
            "ports": {"complete": 0, "total": 4},
            "connections": {"complete": 1, "total": 1},
            "messages": {"complete": 0, "total": 0},
            "overall": {"percent": 100.0},
        });
        let html = stats_html(Some(&score));
        assert!(html.contains(">Components</span><b>1/2</b>"));
        assert!(html.contains(">Ports</span><b>0/4</b>"));
        assert!(html.contains(">Connections</span><b>1/1</b>"));
        assert!(html.contains(">Messages</span><b>0/0</b>"));
        assert!(html.contains(">Overall</span><b>100.0%</b>"));
        assert_eq!(stats_html(None), "");
    }

    #[test]
    fn ok_panel_matches_python_byte_format() {
        let output = Verdict::new(vec![], vec![], Some(json!({"overall": {"percent": 100.0}})));
        let html = panel_html(&output);
        assert!(html.contains("<div class=\"rhizz-diag rhizz-ok\">"));
        assert!(html.contains("\u{2713} No errors, no warnings"));
        assert!(html.contains("100.0%"));
    }

    #[test]
    fn warnings_panel_lists_warnings_and_score() {
        let output = Verdict::new(
            vec![],
            vec![NormDiagnostic {
                code: "W001".to_owned(),
                line: None,
                message: "m".to_owned(),
            }],
            Some(json!({"overall": {"percent": 66.7}})),
        );
        let html = panel_html(&output);
        assert!(html.contains("rhizz-warn"));
        assert!(html.contains("\u{26a0} 1 warning \u{2014} model completes at 66.7%"));
        assert!(html.contains("<ul class=\"rhizz-diagnostics rhizz-warnings\">"));
    }

    #[test]
    fn error_panel_lists_errors_then_warnings_no_score() {
        let output = Verdict::new(
            vec![NormDiagnostic {
                code: "E011".to_owned(),
                line: None,
                message: "boom".to_owned(),
            }],
            vec![NormDiagnostic {
                code: "W005".to_owned(),
                line: None,
                message: "dup".to_owned(),
            }],
            None,
        );
        let html = panel_html(&output);
        assert!(html.contains("<div class=\"rhizz-diag rhizz-error\">"));
        assert!(
            html.contains("\u{2717} 1 error, 1 warning \u{2014} no score (compilation failed)")
        );
        assert!(html.contains("<ul class=\"rhizz-diagnostics rhizz-errors\">"));
        assert!(html.contains("<ul class=\"rhizz-diagnostics rhizz-warnings\">"));
        assert!(!html.contains("rhizz-stats")); // no score on failure
    }

    #[test]
    fn ignore_and_tool_panels_are_stable() {
        assert_eq!(
            IGNORE_PANEL,
            "<div class=\"rhizz-diag rhizz-ignore\"><div class=\"rhizz-head\">Not compiled in this book</div></div>"
        );
        let tool = tool_error_panel("a <broken>");
        assert!(tool.contains("rhizz-tool"));
        assert!(tool.contains("a &lt;broken&gt;"));
    }
}
