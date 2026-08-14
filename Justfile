# Common development tasks for the workspace.

format:
    @if command -v nix >/dev/null 2>&1; then \
        nix develop --command cargo fmt --all; \
        (cd web && nix develop --command deno fmt); \
    else \
        cargo fmt --all; \
        (cd web && deno fmt); \
    fi

lint:
    @if command -v nix >/dev/null 2>&1; then \
        nix develop --command cargo clippy --all-targets --all-features -- -D warnings; \
        (cd web && nix develop --command deno lint); \
    else \
        cargo clippy --all-targets --all-features -- -D warnings; \
        (cd web && deno lint); \
    fi

test:
    @if command -v nix >/dev/null 2>&1; then \
        nix develop --command cargo test --all; \
        (cd web && nix develop --command deno run npm:vitest run); \
    else \
        cargo test --all; \
        (cd web && deno run npm:vitest run); \
    fi

build:
    @if command -v nix >/dev/null 2>&1; then \
        nix develop --command cargo build; \
        nix develop --command wasm-pack build crates/rhizz-wasm --target web; \
        (cd web && nix develop --command deno run npm:vite build); \
    else \
        cargo build; \
        wasm-pack build crates/rhizz-wasm --target web; \
        (cd web && deno run npm:vite build); \
    fi
