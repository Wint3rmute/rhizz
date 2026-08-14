# Common development tasks for the workspace.

format:
    @if command -v nix >/dev/null 2>&1 && { [ -f flake.nix ] || [ -f ../flake.nix ]; }; then \
        nix develop --command cargo fmt --all && \
        nix develop --command deno fmt web; \
    else \
        cargo fmt --all && \
        (cd web && deno fmt); \
    fi

lint:
    @if command -v nix >/dev/null 2>&1 && { [ -f flake.nix ] || [ -f ../flake.nix ]; }; then \
        nix develop --command cargo clippy --all-targets --all-features -- -D warnings && \
        nix develop --command sh -lc 'cd web && deno run lint && deno task check'; \
    else \
        cargo clippy --all-targets --all-features -- -D warnings && \
        (cd web && deno lint); \
    fi

test:
    @if command -v nix >/dev/null 2>&1 && { [ -f flake.nix ] || [ -f ../flake.nix ]; }; then \
        nix develop --command cargo test --quiet --all && \
        nix develop --command sh -lc 'cd web && deno run test --project=unit_tests'; \
    else \
        cargo test --all; \
        (cd web && deno run npm:vitest run); \
    fi

build:
    @if command -v nix >/dev/null 2>&1 && { [ -f flake.nix ] || [ -f ../flake.nix ]; }; then \
        nix develop --command cargo build --release && \
        nix develop --command wasm-pack build crates/rhizz-wasm --target web --release && \
        (cd web && nix develop --command sh -lc 'deno run build'); \
    else \
        cargo build && \
        wasm-pack build crates/rhizz-wasm --target web && \
        (cd web && deno run build); \
    fi
