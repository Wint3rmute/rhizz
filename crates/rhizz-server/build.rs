//! Build script for `rhizz-server`.
//!
//! Bundles the compiled web frontend (`web/build`, produced by `vite
//! build`) into the binary via [`rust-embed`]. The frontend is a pure SPA
//! (`ssr = false`), so its build output is the shell page `404.html` plus
//! hashed assets under `_app/` — there is deliberately no `index.html`.
//!
//! `web/build` is gitignored, so this script falls back to a placeholder
//! shell page when the frontend was never built (e.g. in the CI rust job,
//! which has no Node toolchain). `just build` builds the frontend *before*
//! `cargo build`, so the canonical build always embeds the real UI.
//!
//! The script never invokes the frontend build itself: cargo runs build
//! scripts once per target and vite would race with itself (clearing
//! `outDir` concurrently) and slow down plain rust-only builds.

use std::env;
use std::fs;
use std::path::{Path, PathBuf};

/// Minimal SPA shell served when the real frontend was never built.
const PLACEHOLDER_HTML: &str = r#"<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>rhizz-server</title></head>
  <body>
    <h1>rhizz-server is running</h1>
    <p>The web frontend is not embedded in this binary.</p>
    <p>Rebuild with <code>just build</code> (or run
    <code>cd web &amp;&amp; deno run build</code> first) to bundle the editor UI.</p>
  </body>
</html>
"#;

/// Absolute path to the vite build output directory (`web/build`).
fn build_dir() -> PathBuf {
    let Some(manifest) = env::var_os("CARGO_MANIFEST_DIR") else {
        // Cargo always sets this; a missing value means a broken build env.
        return PathBuf::from(".");
    };
    PathBuf::from(manifest)
        .join("..")
        .join("..")
        .join("web")
        .join("build")
}

/// Writes the placeholder shell so the crate compiles without a frontend.
fn write_placeholder(build_dir: &Path) {
    if let Err(err) = fs::create_dir_all(build_dir)
        .and_then(|()| fs::write(build_dir.join("404.html"), PLACEHOLDER_HTML))
    {
        println!("cargo:warning=rhizz-server: could not write placeholder frontend: {err}");
    }
}

fn main() {
    let build_dir = build_dir();

    // Declare the custom cfg so `unexpected_cfgs` doesn't fire on it.
    println!("cargo::rustc-check-cfg=cfg(rhizz_has_embedded_assets)");

    // The SPA shell page doubles as the "frontend was built" marker.
    if build_dir.join("404.html").is_file() {
        println!("cargo:rustc-cfg=rhizz_has_embedded_assets");
    } else {
        write_placeholder(&build_dir);
        println!(
            "cargo:warning=rhizz-server: no frontend build found; embedding a placeholder — \
             run `just build` to embed the real UI"
        );
    }

    // Re-embed whenever the frontend output changes.
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=src");
    println!("cargo:rerun-if-changed={}", build_dir.display());
}
