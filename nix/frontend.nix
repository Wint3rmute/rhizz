# Builds the web frontend (`web/build` — the static SPA shell plus hashed
# `_app/` assets) with `buildNpmPackage`.
#
# Stage 2 of the Nix pipeline: consumes the wasm package (stage 1,
# `rhizz-wasm-pkg`) and feeds `rhizz-server`'s build.rs (stage 3), which embeds
# `web/build` into the binary.
#
# npm dependencies come from `importNpmLock` (reading `web/package-lock.json`),
# so there is no `npmDepsHash` to maintain by hand. The `rhizz` wasm package is
# a local `file:` dependency in the lock; `packageSourceOverrides` points its
# two lock entries at the built derivation instead of a path in the source
# tree (the latter is gitignored and absent from a clean checkout).
{
  lib,
  buildNpmPackage,
  importNpmLock,
  rhizz-wasm-pkg,
  src,
}:

buildNpmPackage {
  pname = "rhizz-web";
  version = "0.0.1";

  inherit src;

  npmDeps = importNpmLock {
    npmRoot = src;
    packageSourceOverrides = {
      # The real local package, and the `node_modules/rhizz` symlink that
      # points at it.
      "../crates/rhizz-wasm/pkg" = rhizz-wasm-pkg;
      "node_modules/rhizz" = rhizz-wasm-pkg;
    };
  };
  npmConfigHook = importNpmLock.npmConfigHook;

  # Baked in at build time: the embedded frontend talks to its own origin
  # (`/api/vfs`) rather than a hardcoded host. "prod" makes the frontend send
  # errors to Sentry through the server tunnel (see web/src/hooks.client.ts).
  # Sentry's source-map upload is not configured here, so the vite config takes
  # its tokenless "no source maps" path.
  VITE_RHIZZ_SERVER_URL = "/";
  VITE_RHIZZ_DEPLOYMENT = "prod";

  # npmConfigHook installs with `--ignore-scripts`, so the `prepare` script
  # (`svelte-kit sync`) never runs. Run it here: it generates
  # `.svelte-kit/tsconfig.json`, which the root tsconfig.json extends and the
  # build reads.
  preBuild = "npm run sync";

  # The derivation *is* the vite output directory (rhizz-server's build.rs
  # embeds it), so install `build/` at the root of $out.
  installPhase = ''
    runHook preInstall
    mkdir -p $out
    cp -r build/. $out/
    runHook postInstall
  '';

  meta = {
    description = "Rhizz web frontend (static SPA build)";
    license = lib.licenses.eupl12;
  };
}
