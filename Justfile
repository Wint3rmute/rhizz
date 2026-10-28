# Common development tasks for the workspace.

has_nix := if shell('command -v nix >/dev/null 2>&1 && { [ -f flake.nix ] || [ -f ../flake.nix ]; } && echo 1 || echo 0') == "1" {
    "true"
} else {
    "false"
}

alias c := lint-commit
alias b := build
alias w := wasm
alias t := test
alias d := dev
alias s := storybook
alias f := format
alias fmt := format
alias bs := book-serve

run := if has_nix == "true" { "nix develop --command" } else { "" }

# Versions come from git tags (version_provider = "scm").
# Bumps from commits since the last tag, updates CHANGELOG.md, creates the tag.
# Preview first with `just bump --dry-run`.
bump *args:
    {{run}} cz bump {{args}}

# Regenerates CHANGELOG.md.
changelog *args:
    {{run}} cz changelog {{args}}

format:
    {{run}} cargo fmt --all
    {{run}} sh -c 'cd web && npm run format'

lint: lint-rust lint-frontend lint-commit

lint-rust:
    {{run}} sh -c 'cargo clippy --all-targets --all-features -- -D warnings && cargo doc --no-deps --all'

lint-frontend:
    {{run}} sh -c 'cd web && npm run sync && npm run eslint && npm run check-only'

# Validates every commit since BASE. CI runs the same check on PRs.
# Checks commits since origin/main by default.
lint-commit base="origin/main":
    {{run}} sh -c 'if [ -z "$(git rev-list {{base}}..HEAD)" ]; then echo "No commits since {{base}}, nothing to check."; else cz check --rev-range {{base}}..HEAD; fi'

test: wasm
    {{run}} cargo test --quiet --all
    {{run}} sh -c 'cd web && npm run test'
    {{run}} sh -c 'cd web && npm run test:e2e'

# Single instrumented coverage pass, mirroring CI: runs all tests (incl.
# doctests, hence RUSTC_BOOTSTRAP) under llvm-cov, enforces the 80% line
# gate, and writes lcov + cobertura reports under target/coverage/.
# rhizz-wasm is excluded (wasm cdylib, no host tests) and crates/*/tests
# are not counted as source.
coverage:
    {{run}} mkdir -p target/coverage
    {{run}} sh -c 'RUSTC_BOOTSTRAP=1 cargo llvm-cov --workspace --all-features --exclude rhizz-wasm --ignore-filename-regex "crates/.*/tests/" --doctests --fail-under-lines 80 --lcov --output-path target/coverage/lcov.info'
    {{run}} sh -c 'cargo llvm-cov report -p rhizz-core -p rhizz-cli -p rhizz-server -p rhizz-book --ignore-filename-regex "crates/.*/tests/" --cobertura --output-path target/coverage/cobertura.xml'

# Builds the wasm package via its Nix derivation (nix/wasm.nix) — the same
# build CI runs — and syncs the result into crates/rhizz-wasm/pkg/, the
# `file:` dependency of web/. Requires nix; there is no non-nix fallback
# (the flake pins wasm-pack and a matching wasm-bindgen-cli).
#
# NOTE: `nix build .#` snapshots the git tree, so edits to already-tracked
# files are picked up but a brand-new source file must be `git add`ed first.
wasm:
    nix build .#rhizz-wasm-pkg
    rm -rf crates/rhizz-wasm/pkg
    mkdir -p crates/rhizz-wasm/pkg
    cp -rL result/. crates/rhizz-wasm/pkg/
    chmod -R u+w crates/rhizz-wasm/pkg

# Builds the web app into web/build/ via its Nix derivation (nix/frontend.nix) —
# the same artifact rhizz-server embeds — so what gets embedded is what
# production ships. It also makes the build hermetic: it uses the locked
# dependency graph rather than whatever happens to be in the devshell's
# node_modules (which is what `npm run build` silently used).
#
# The cost is speed: ~28s for a one-line change, against ~6s for
# `npm run build`. Use `just dev` for the fast loop.
#
# Same caveat as `wasm`: `nix build .#` snapshots the git tree, so a brand-new
# source file must be `git add`ed before it appears in the build.
web-build:
    nix build .#rhizz-frontend
    rm -rf web/build
    mkdir -p web/build
    cp -rL result/. web/build/
    chmod -R u+w web/build

# Frontend artifacts first, so rhizz-server's build.rs (run when rhizz-cli
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
    {{run}} sh -c 'cd web && npm run build-storybook'
    {{run}} cargo build --release --all-targets

# Builds the mdBook (book/). The preprocessor (crates/rhizz-book) compiles
# every ```rhizz block in-process and verifies the results against
# book/book.lock (regenerate with `just book-accept` after intentional
# changes).
book:
    {{run}} cargo build --quiet --bin rhizz-book
    {{run}} mdbook build book

# Regenerates book/book.lock from the current compiler output.
# Review the per-block diff it prints before committing.
# NOTE: plain `sh -c` (not `sh -lc`) — a login shell resets PATH and loses
# the nix dev shell, where mdbook lives. Same reason the web recipes below
# avoid `-l`.
book-accept:
    {{run}} cargo build --quiet --bin rhizz-book
    {{run}} env BOOKLOCK_ACCEPT_CHANGES=1 mdbook build book

book-serve:
    {{run}} mdbook serve book

# Visual regression tests: full-page screenshot of every Storybook story in
# dark + light, diffed against web/vrt/__screenshots__/. Always writes the
# gallery to web/vrt-report/index.html (open it straight from disk).
# Extra args go to Playwright, e.g. `just vrt -g navbar`.
vrt *args: wasm
    {{run}} sh -c 'cd web && npm run build-storybook -- --quiet'
    {{run}} sh -c 'cd web && npm run test:vrt -- {{args}}'

# Same as `vrt`, but skips the wasm + Storybook rebuild.
vrt-quick *args:
    {{run}} sh -c 'cd web && npm run test:vrt -- {{args}}'

# Re-baselines every changed/new screenshot (review the gallery first!).
# Also mirrors derived artifacts into regular files the app/book can bundle
# (ScrollingBackground sources, README/book landing shot): the VRT baselines
# themselves live in Git LFS and can't be bundled.
vrt-accept *args:
    {{run}} sh -c 'cd web && npm run test:vrt:accept -- {{args}}'
    cp web/vrt/__screenshots__/backgrounds-background-1--light.png web/src/screenshots/background_1.png
    cp web/vrt/__screenshots__/backgrounds-background-2--light.png web/src/screenshots/background_2.png
    cp web/vrt/__screenshots__/backgrounds-background-3--light.png web/src/screenshots/background_3.png
    cp web/vrt/__screenshots__/backgrounds-background-4--light.png web/src/screenshots/background_4.png
    cp web/vrt/__screenshots__/pages-projects--empty-landing--light.png book/src/rhizz_landing.png

# Starts a dev server. If you're an AI, never use this. It will just hang forever.
dev: wasm
    {{run}} sh -c 'cd web && npm ci && npm run dev'

# Starts a storybook server. If you're an AI, never use this. It will just hang forever.
# Syncs first for the same reason `build` does.
storybook:
    {{run}} sh -c 'cd web && npm run sync'
    {{run}} sh -c 'cd web && npm run storybook'

# Serves the UI with examples/ as the server's data dir: each example is a
# directory of plain HCL, which is exactly what the server persists, so the
# examples come up as editable projects — and edits land in the working tree.
#
# The frontend is built with VITE_RHIZZ_SERVER_URL=/ first, and that is not
# optional: the rhizz binary embeds web/build at compile time (rhizz-server's
# build.rs), and a frontend built without that variable talks to localStorage
# instead of /api/vfs — the API would serve the examples to nobody. `/` means
# "my own origin", which is the server itself. `web-build` bakes exactly that
# value in, so the recipe just depends on it.
#
# If you're an AI, never use this. It will just hang forever.
serve: web-build
    {{run}} cargo build --release -p rhizz-cli
    {{run}} env RHIZZ_DATA_DIR=examples cargo run --release -p rhizz-cli -- web
