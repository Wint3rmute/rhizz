//! Compile-time embedding of the web frontend.
//!
//! [`crate::assets::StaticAssets`] holds every file `vite build` produced in `web/build`,
//! baked into the binary by [`build.rs`](crate). Serving logic in
//! `server.rs` reads from this struct; the `rhizz_has_embedded_assets`
//! cfg (emitted by build.rs) distinguishes a real frontend from the
//! placeholder page fallback.

use rust_embed::Embed;

/// Files from `web/build`, embedded at compile time.
///
/// The frontend is a pure SPA, so the shell page is `404.html` (there is
/// deliberately no `index.html`); the set always contains it — either the
/// real app or the placeholder written by build.rs.
#[derive(Embed)]
#[folder = "$CARGO_MANIFEST_DIR/../../web/build"]
pub struct StaticAssets;

#[cfg(rhizz_has_embedded_assets)]
#[cfg(test)]
mod tests {
    use super::StaticAssets;

    #[test]
    fn spa_shell_is_embedded_when_frontend_was_built() {
        let names: Vec<String> = StaticAssets::iter().map(|f| f.to_string()).collect();
        assert!(
            names.iter().any(|n| n == "404.html"),
            "expected 404.html (SPA shell) among embedded assets: {names:?}"
        );
    }
}
