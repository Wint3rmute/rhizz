# Common development tasks for the workspace.

format:
    @if command -v nix >/dev/null 2>&1 && { [ -f flake.nix ] || [ -f ../flake.nix ]; }; then \
        nix develop --command sh -lc 'cargo fmt --all'; \
        (cd web && nix develop --command sh -lc 'deno fmt'); \
    else \
        cargo fmt --all; \
        (cd web && deno fmt); \
    fi

lint:
    @if command -v nix >/dev/null 2>&1 && { [ -f flake.nix ] || [ -f ../flake.nix ]; }; then \
        nix develop --command sh -lc 'cargo clippy --all-targets --all-features -- -D warnings'; \
        (cd web && nix develop --command sh -lc 'deno lint'); \
    else \
        cargo clippy --all-targets --all-features -- -D warnings; \
        (cd web && deno lint); \
    fi

test:
    @if command -v nix >/dev/null 2>&1 && { [ -f flake.nix ] || [ -f ../flake.nix ]; }; then \
        nix develop --command sh -lc 'cargo test --all'; \
        (cd web && nix develop --command sh -lc 'deno run npm:vitest run'); \
    else \
        cargo test --all; \
        (cd web && deno run npm:vitest run); \
    fi

build:
    @if command -v nix >/dev/null 2>&1 && { [ -f flake.nix ] || [ -f ../flake.nix ]; }; then \
        nix develop --command sh -lc 'cargo build'; \
        nix develop --command sh -lc 'wasm-pack build crates/rhizz-wasm --target web'; \
        (cd web && nix develop --command sh -lc 'deno run npm:vite build'); \
    else \
        cargo build; \
        wasm-pack build crates/rhizz-wasm --target web; \
        (cd web && deno run npm:vite build); \
    fi
