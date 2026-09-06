//! Small HTML fragments for the mdBook preprocessor.
//!
//! Compiled `` ```rhizz `` blocks render as live `/book-example` embeds (see
//! `project::render_project_html`); only the non-compiled fragments live
//! here: the `` ```rhizz,ignore `` notice and the defensive tool-error panel.

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
    use super::{IGNORE_PANEL, esc, tool_error_panel};

    #[test]
    fn esc_escapes_all_five_html_chars() {
        assert_eq!(esc("a&b<c>d\"e'f"), "a&amp;b&lt;c&gt;d&quot;e&#x27;f");
        assert_eq!(esc("plain text"), "plain text");
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
