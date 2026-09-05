# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────────────────────
# Stage 1 — build the frontend.
#
# Produces `web/build` (the SPA shell `404.html` + hashed `_app/` assets) that
# `rhizz-server` embeds at compile time via build.rs. The frontend depends on
# the WASM package (`file:../crates/rhizz-wasm/pkg/`), so we build that first.
#
# VITE_RHIZZ_SERVER_URL is baked in at build time: set to "/" so the embedded
# frontend talks to the same-origin `/api/vfs` (the VFS persistence API) rather
# than a hardcoded host.
# ─────────────────────────────────────────────────────────────────────────────
FROM rust:1-bookworm AS frontend

WORKDIR /app

# Rust toolchain is already present; add the wasm32 target + wasm-pack.
# The frontend build also needs Node (npm + vite), which the rust image
# doesn't ship — install a pinned Node 22 LTS from the official tarball.
RUN rustup target add wasm32-unknown-unknown \
    && cargo install wasm-pack --locked \
    && curl -fsSL https://nodejs.org/dist/v22.14.0/node-v22.14.0-linux-x64.tar.xz \
        | tar -xJ -C /usr/local --strip-components=1

# Build the WASM package that the web frontend imports. Copy the whole
# crates/ tree: the workspace Cargo.toml lists every crate as a member, so
# `cargo metadata` (which wasm-pack invokes) needs all of them present even
# though only rhizz-wasm is built here. Also copy SPEC/ and examples/: the
# rhizz-core build script embeds SPEC/diagnostics and examples/ via
# include_str! and fails if they're missing.
COPY crates crates
COPY SPEC SPEC
COPY examples examples
COPY Cargo.toml Cargo.lock ./
RUN wasm-pack build crates/rhizz-wasm --target web --release

# Build the frontend with the VFS-sync env var set.
COPY web web
RUN cd web \
    && npm install \
    && VITE_RHIZZ_SERVER_URL=/ npm run build

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2 — build the backend, embedding the frontend artifacts.
#
# Copies `web/build` (and the wasm pkg) from the frontend stage, then compiles
# `rhizz-server`. build.rs embeds `web/build` into the binary, so the release
# binary below is fully self-contained.
# ─────────────────────────────────────────────────────────────────────────────
FROM rust:1-bookworm AS backend

WORKDIR /app

# Frontend artifacts for build.rs to embed.
COPY --from=frontend /app/web/build web/build
COPY --from=frontend /app/crates/rhizz-wasm/pkg crates/rhizz-wasm/pkg

# Backend sources. SPEC/ and examples/ are needed by the rhizz-core build
# script (it embeds SPEC/diagnostics and examples/ via include_str!).
# Every workspace member crate must be present so the workspace manifest
# resolves (rhizz-book is a member even though the server doesn't link it).
COPY crates/rhizz-core crates/rhizz-core
COPY crates/rhizz-cli crates/rhizz-cli
COPY crates/rhizz-server crates/rhizz-server
COPY crates/rhizz-wasm crates/rhizz-wasm
COPY crates/rhizz-book crates/rhizz-book
COPY SPEC SPEC
COPY examples examples
COPY Cargo.toml Cargo.lock ./

# Compile the server (release). The frontend is embedded here, so this is the
# only artifact the runtime stage needs.
RUN cargo build --release -p rhizz-server

# ─────────────────────────────────────────────────────────────────────────────
# Stage 3 — minimal runtime.
#
# Only the statically-linked release binary. The VFS data dir is a mounted
# volume at /data (see fly.toml / RHIZZ_DATA_DIR).
# ─────────────────────────────────────────────────────────────────────────────
FROM debian:bookworm-slim AS runtime

# CA certificates for any outbound TLS; not strictly needed today but cheap.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Where the VFS persistence volume is mounted.
RUN mkdir -p /data

COPY --from=backend /app/target/release/rhizz-server /usr/local/bin/rhizz-server

# rhizz-server binds RHIZZ_ADDR (default 127.0.0.1:3000); Fly forwards to the
# container port, so bind all interfaces. The data dir defaults to ./rhizz-data
# relative to cwd, so point it at the volume.
ENV RHIZZ_ADDR=0.0.0.0:8080 \
    RHIZZ_DATA_DIR=/data \
    RUST_LOG=info

EXPOSE 8080

CMD ["rhizz-server"]
