# Builds the `rhizz` binary (`rhizz-cli`) with the web frontend embedded.
#
# Stage 3 of the Nix pipeline: consumes the frontend build (stage 2,
# `rhizz-web`) and embeds it into the binary via rhizz-server's build.rs
# (rust-embed).
#
# The source is `rustSrc` from flake.nix: the workspace manifests, the crates,
# and SPEC/ + examples/ (rhizz-core's build script embeds the latter two via
# include_str!). Dependencies are vendored from the workspace lockfile, so
# there is no fixed-output hash to maintain by hand.
#
# rhizz-server's build.rs looks for the frontend at `<workspace>/web/build`
# relative to its own CARGO_MANIFEST_DIR — a hardcoded path. `rhizz-web` is
# copied there in `preBuild`, so the Rust side needs no change; the copy lands
# in the writable build directory, not the read-only store source.
{
  lib,
  rustPlatform,
  rhizz-web,
  src,
  # Short commit the source was built from, shown in the UI via
  # `/api/version`. Passed in from the flake so this derivation has no git dependency.
  gitSha ? "dev",
}:

rustPlatform.buildRustPackage {
  pname = "rhizz";
  version = "0.1.0";

  inherit src;

  # Read by rhizz-server's `option_env!`. Setting it here rather than in
  # `preBuild` means only this derivation rebuilds when the commit changes.
  RHIZZ_GIT_SHA = gitSha;

  # Vendored from the workspace lockfile; no hash to maintain by hand.
  cargoLock.lockFile = "${src}/Cargo.lock";

  # Place the real frontend where build.rs looks for it (`web/build`), so the
  # binary embeds the production UI rather than the placeholder shell.
  preBuild = ''
    mkdir -p web/build
    cp -r ${rhizz-web}/. web/build/
  '';

  # Only the CLI and its dependencies are needed. A bare `cargo build` in this
  # virtual workspace would also compile rhizz-wasm and rhizz-book, neither of
  # which the `rhizz` binary links — mirroring the Dockerfile's
  # `cargo build --release -p rhizz-cli`.
  cargoBuildFlags = [ "-p" "rhizz-cli" ];

  # The crates have their own suites (`just test`); this derivation mirrors the
  # Docker image, which only builds.
  doCheck = false;

  meta = {
    description = "Rhizz model-based systems engineering tool (embedded web UI)";
    license = lib.licenses.eupl12;
    mainProgram = "rhizz";
  };
}
