# Builds the `rhizz-wasm` WebAssembly package (`crates/rhizz-wasm/pkg/`).
#
# This is stage 1 of the Nix build pipeline (see flake.nix `packages`): it turns
# the Rust `rhizz-wasm` crate into the npm package that the web frontend imports
# as `file:../crates/rhizz-wasm/pkg/`.
#
# It mirrors `just wasm` exactly — same `wasm-pack build --target web --release`
# invocation — but hermetically: `cargoLock` vendors the workspace's Cargo.lock
# dependencies, and `wasm-bindgen-cli` is pinned to the version the locked
# nixpkgs ships, which must match the `wasm-bindgen` crate in Cargo.lock (both
# 0.2.129 today). wasm-pack picks the CLI up from PATH instead of downloading
# it, so the sandboxed build needs no network.
#
# `HOME` is redirected to a scratch dir because wasm-pack writes its cache under
# `$HOME/.cache/.wasm-pack`; without it the sandbox's read-only HOME fails.
{
  lib,
  rustPlatform,
  wasm-pack,
  wasm-bindgen-cli,
  lld,
  src,
}:

rustPlatform.buildRustPackage {
  pname = "rhizz-wasm-pkg";
  version = "0.1.0";

  inherit src;

  # Vendored from the workspace lockfile; no hash to maintain by hand.
  cargoLock.lockFile = "${src}/Cargo.lock";

  nativeBuildInputs = [
    wasm-pack
    wasm-bindgen-cli
    # rustc on NixOS links wasm via `lld`; the devshell provides it too.
    lld
  ];

  # `just wasm`, verbatim. Overriding buildPhase keeps buildRustPackage's
  # cargo vendoring (the generated `.cargo/config.toml` is found by the cargo
  # invocation wasm-pack shells out to), but replaces its `cargo build` with
  # the wasm-pack pipeline.
  buildPhase = ''
    runHook preBuild
    export HOME=$(mktemp -d)
    wasm-pack build crates/rhizz-wasm --target web --release
    runHook postBuild
  '';

  # The derivation *is* the pkg directory: step 2 depends on its contents as an
  # npm `file:` dependency.
  installPhase = ''
    runHook preInstall
    mkdir -p $out
    cp -r crates/rhizz-wasm/pkg/. $out/
    runHook postInstall
  '';

  doCheck = false;

  meta = {
    description = "WebAssembly bindings for rhizz-core (npm package)";
    license = lib.licenses.eupl12;
  };
}
