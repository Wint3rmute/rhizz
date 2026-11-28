# Common development tasks for the workspace.
#
# Nix is required. Every recipe runs a runnable script defined in
# nix/tasks.nix via `nix run .#<task>` — each script declares exactly the
# binaries it needs (`{pkgs.cargo}/bin/cargo`, ...), so a Rust lint never
# pulls Node/browsers/mdbook. Scripts execute in the working tree (dirty
# edits and incremental `target/` / `node_modules/` keep working).
# `wasm` / `web-build` use `nix build` (the same derivations CI uses).

alias c := lint-commit
alias b := build
alias w := wasm
alias t := test
alias d := dev
alias s := storybook
alias f := format
alias fmt := format
alias bs := book-serve

# Versions come from git tags (version_provider = "scm").
# Bumps from commits since the last tag, updates CHANGELOG.md, creates the tag.
# HEADLINE becomes the annotated tag subject, used as the GitHub Release title.
# Preview first with `just bump "My headline" --dry-run`.
bump headline *args:
    nix run .#bump -- "{{headline}}" {{args}}

# Regenerates CHANGELOG.md.
changelog *args:
    nix run .#changelog -- {{args}}

format:
    nix run .#format

lint: lint-rust lint-frontend lint-commit

lint-rust:
    nix run .#lint-rust

lint-frontend:
    nix run .#lint-frontend

# Validates every commit since BASE. CI runs the same check on PRs.
# Checks commits since origin/main by default.
lint-commit base="origin/main":
    nix run .#lint-commit -- {{base}}

# Advisory scan of Cargo.lock. CI runs the same check on main.
audit:
    nix run .#audit

# API reference (`cargo doc`). Also built as part of lint-rust.
doc:
    nix run .#doc

# Installs web/ dependencies. CI glue (the web tasks assume node_modules
# exists); locally `just dev` covers this.
install-web:
    nix run .#install-web

test: wasm
    nix run .#test-rust
    nix run .#test-web
    nix run .#test-e2e

# Single instrumented coverage pass, mirroring CI: runs all tests (incl.
# doctests, hence RUSTC_BOOTSTRAP) under llvm-cov, enforces the 80% line
# gate, and writes lcov + cobertura reports under target/coverage/.
# rhizome-wasm is excluded (wasm cdylib, no host tests) and crates/*/tests
# are not counted as source.
#
# NOTE: rustc's coverage profiles require matching LLVM tools (see
# nix/tasks.nix `coverage`); keep the two in step on toolchain bumps.
coverage:
    nix run .#coverage

# Builds the wasm package via its Nix derivation (nix/wasm.nix) — the same
# build CI runs — and syncs the result into crates/rhizome-wasm/pkg/, the
# `file:` dependency of web/. Requires nix (the flake pins wasm-pack and
# a matching wasm-bindgen-cli).
#
# NOTE: `nix build .#` snapshots the git tree, so edits to already-tracked
# files are picked up but a brand-new source file must be `git add`ed first.
wasm:
    nix build .#rhizome-wasm-pkg
    rm -rf crates/rhizome-wasm/pkg
    mkdir -p crates/rhizome-wasm/pkg
    cp -rL result/. crates/rhizome-wasm/pkg/
    chmod -R u+w crates/rhizome-wasm/pkg

# Builds the web app into web/build/ via its Nix derivation (nix/frontend.nix) —
# the same artifact rhizome-server embeds — so what gets embedded is what
# production ships. It also makes the build hermetic: it uses the locked
# dependency graph rather than whatever happens to be in a devshell's
# node_modules (which is what `npm run build` silently used).
#
# The cost is speed: ~28s for a one-line change, against ~6s for
# `npm run build`. Use `just dev` for the fast loop.
#
# Same caveat as `wasm`: `nix build .#` snapshots the git tree, so a brand-new
# source file must be `git add`ed before it appears in the build.
web-build:
    nix build .#rhizome-frontend
    rm -rf web/build
    mkdir -p web/build
    cp -rL result/. web/build/
    chmod -R u+w web/build

# Frontend artifacts first, so rhizome-server's build.rs (run when rhizome-cli
# compiles its dependency) embeds the real UI. The wasm pkg is a file:
# dependency of web/, and vite populates web/build.
#
# The app build goes through `web-build` above; Storybook does not have a
# derivation, so it stays on npm. It goes through a package.json script rather
# than a bare `storybook build` because the script runs `svelte-kit sync`
# first: tsconfig.json extends `$app/tsconfig`, which only exists once sync has
# written node_modules/$app/tsconfig.json, and the tool reads tsconfig.json
# before anything syncs.
build: web-build
    nix run .#build

# Builds the mdBook (book/). The preprocessor (crates/rhizome-book) compiles
# every ```rhizome block in-process and verifies the results against
# book/book.lock (regenerate with `just book-accept` after intentional
# changes).
book:
    nix run .#book

# Regenerates book/book.lock from the current compiler output.
# Review the per-block diff it prints before committing.
book-accept:
    nix run .#book-accept

book-serve:
    nix run .#book-serve

# Visual regression tests: full-page screenshot of every Storybook story in
# dark + light, diffed against web/vrt/__screenshots__/. Always writes the
# gallery to web/vrt-report/index.html (open it straight from disk).
# Extra args go to Playwright, e.g. `just vrt -g navbar`.
vrt *args: wasm
    nix run .#vrt -- {{args}}

# Same as `vrt`, but skips the wasm + Storybook rebuild.
vrt-quick *args:
    nix run .#vrt-quick -- {{args}}

# Re-baselines every changed/new screenshot (review the gallery first!).
# Also mirrors derived artifacts into regular files the app/book can bundle
# (ScrollingBackground sources, README/book landing shot): the VRT baselines
# themselves live in Git LFS and can't be bundled.
vrt-accept *args:
    nix run .#vrt-accept -- {{args}}

# Regenerates all declaratively generated graphics: the 3D README/book hero
# (logo/renders/landing/rhizome_landing.png, from the VRT landing screenshot) and the logo
# SVGs (logo/renders/molecule/). Pass a custom screenshot to preview the hero
# with your own capture, e.g.:
#   just assets my-apollo-shot.png
assets input="web/vrt/__screenshots__/pages-landing--no-projects--light.png":
    nix run .#assets -- {{input}}

# Fails if the committed landing hero or logo SVGs differ from what `assets`
# generates. CI runs the same check in the visual-regressions job.
assets-check:
    nix run .#assets-check

# Renders the animated-gradient logo videos (Full HD MP4, light + dark) into
# logo/renders/video/. Extra args go to logo/src/gradient.mjs, e.g.:
#   just logo-video --variant dark --seconds 4
logo-video *args:
    nix run .#logo-video -- {{args}}

# Renders the logo intro animation (Full HD MP4, 5 s, light + dark) into
# logo/renders/video/. Extra args go to logo/src/intro.mjs, e.g.:
#   just logo-intro --variant dark --fps 30
logo-intro *args:
    nix run .#logo-intro -- {{args}}

# Regenerates the examples table in examples/README.md from each example's
# `project` block (`full_name`, `description`). `just test` fails when stale.
examples-readme:
    nix run .#examples-readme

# Re-captures those screenshots from the running app (drone example).
# Run `just wasm` first. Then `just assets` to recompose.
logo-social-shots *args:
    nix run .#logo-social-shots -- {{args}}

# Starts a dev server. If you're an AI, never use this. It will just hang forever.
dev: wasm
    nix run .#dev

# Starts a storybook server. If you're an AI, never use this. It will just hang forever.
# Syncs first for the same reason `build` does.
storybook:
    nix run .#storybook

# Serves the UI with examples/ as the server's data dir: each example is a
# directory of plain HCL, which is exactly what the server persists, so the
# examples come up as editable projects — and edits land in the working tree.
#
# The frontend is built with VITE_RHIZOME_SERVER_URL=/ first, and that is not
# optional: the rhizome binary embeds web/build at compile time (rhizome-server's
# build.rs), and a frontend built without that variable talks to localStorage
# instead of /api/vfs — the API would serve the examples to nobody. `/` means
# "my own origin", which is the server itself. `web-build` bakes exactly that
# value in, so the recipe just depends on it.
#
# If you're an AI, never use this. It will just hang forever.
serve: web-build
    nix run .#serve
