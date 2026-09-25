# Common development tasks for the workspace.

has_nix := if shell('command -v nix >/dev/null 2>&1 && { [ -f flake.nix ] || [ -f ../flake.nix ]; } && echo 1 || echo 0') == "1" {
    "true"
} else {
    "false"
}

alias b := build
alias w := wasm
alias t := test
alias d := dev
alias s := storybook
alias fmt := format
alias bs := book-serve

run := if has_nix == "true" { "nix develop --command" } else { "" }

format:
    {{run}} cargo fmt --all
    {{run}} deno fmt web

lint:
    {{run}} sh -c 'cargo clippy --all-targets --all-features -- -D warnings && cargo doc --no-deps --all && cd web && deno task sync && deno task eslint && deno task check-only'

test: wasm
    {{run}} cargo test --quiet --all
    {{run}} sh -c 'cd web && deno run test'
    {{run}} sh -c 'cd web && dx playwright test'

# Single instrumented coverage pass, mirroring CI: runs all tests (incl.
# doctests, hence RUSTC_BOOTSTRAP) under llvm-cov, enforces the 80% line
# gate, and writes lcov + cobertura reports under target/coverage/.
# rhizz-wasm is excluded (wasm cdylib, no host tests) and crates/*/tests
# are not counted as source.
coverage:
    {{run}} mkdir -p target/coverage
    {{run}} sh -c 'RUSTC_BOOTSTRAP=1 cargo llvm-cov --workspace --all-features --exclude rhizz-wasm --ignore-filename-regex "crates/.*/tests/" --doctests --fail-under-lines 80 --lcov --output-path target/coverage/lcov.info'
    {{run}} sh -c 'cargo llvm-cov report -p rhizz-core -p rhizz-cli -p rhizz-server -p rhizz-book --ignore-filename-regex "crates/.*/tests/" --cobertura --output-path target/coverage/cobertura.xml'

wasm:
    {{run}} wasm-pack build crates/rhizz-wasm --target web --release

# Frontend artifacts first, so rhizz-server's build.rs embeds the real
# UI (wasm pkg is a file: dependency of web/, and vite populates web/build).
build: wasm
    {{run}} sh -c 'cd web && dx vite build'
    {{run}} sh -c 'cd web && dx storybook build'
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
    {{run}} sh -c 'cd web && dx storybook build --quiet'
    {{run}} sh -c 'cd web && dx playwright test -c playwright.vrt.config.ts {{args}}'

# Same as `vrt`, but skips the wasm + Storybook rebuild.
vrt-quick *args:
    {{run}} sh -c 'cd web && dx playwright test -c playwright.vrt.config.ts {{args}}'

# Re-baselines every changed/new screenshot (review the gallery first!).
vrt-accept *args:
    {{run}} sh -c 'cd web && dx playwright test -c playwright.vrt.config.ts --update-snapshots=all {{args}}'

# Starts a dev server. If you're an AI, never use this. It will just hang forever.
dev: wasm
    {{run}} sh -c 'cd web && deno run dev'

# Starts a storybook server. If you're an AI, never use this. It will just hang forever.
storybook:
    {{run}} sh -c 'cd web && dx storybook dev'
