# Common development tasks for the workspace.

has_nix := if shell('command -v nix >/dev/null 2>&1 && { [ -f flake.nix ] || [ -f ../flake.nix ]; } && echo 1 || echo 0') == "1" {
    "true"
} else {
    "false"
}

alias b := build
alias t := test
alias d := dev
alias fmt := format

run := if has_nix == "true" { "nix develop --command" } else { "" }

format:
    {{run}} cargo fmt --all
    {{run}} deno fmt web

lint:
    {{run}} cargo clippy --all-targets --all-features -- -D warnings
    {{run}} cargo doc --no-deps --all
    {{run}} sh -lc 'cd web && deno run lint && deno task check'

test:
    {{run}} cargo test --quiet --all
    {{run}} sh -lc 'cd web && deno run test'

# Frontend artifacts first, so rhizz-server's build.rs embeds the real
# UI (wasm pkg is a file: dependency of web/, and vite populates web/build).
build:
    {{run}} wasm-pack build crates/rhizz-wasm --target web --release
    {{run}} sh -lc 'cd web && npx vite build'
    {{run}} sh -lc 'cd web && dx storybook build'
    {{run}} cargo build --release --all-targets

# Starts a dev server. If you're an AI, never use this. It will just hang forever.
dev:
    {{run}} sh -lc 'cd web && deno run dev'
