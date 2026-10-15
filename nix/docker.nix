# The OCI image deployed to ghcr.io and Fly.io.
#
# Stage 4 of the Nix pipeline: consumes the `rhizz` binary (stage 3) and wraps
# it in a container image. This replaces the three-stage Dockerfile, whose
# frontend/backend stages re-implemented stages 2–3 by hand.
#
# Built `from scratch`: the binary is a Nix artifact whose dynamic dependencies
# live under /nix/store and are reached by absolute RPATH, so it needs no
# userland from a base image. `dockerTools` walks the binary's closure and
# ships it; the Debian base the Dockerfile used only contributed
# ca-certificates, which is added explicitly below.
#
# Differences from the Dockerfile image, both deliberate:
#   - No VITE_SENTRY_DSN. The Dockerfile baked one in via a build arg; the Nix
#     frontend derivation (nix/frontend.nix) builds with Sentry unset, so this
#     image reports nothing to Sentry. Closing that gap needs a Sentry story
#     for the Nix build (see the task's step 5).
#   - Runs as root, as the Dockerfile image did. The server's data dir is a
#     volume; a non-root user would need the volume chowned to match.
{
  lib,
  dockerTools,
  rhizz,
  examples,
}:

dockerTools.buildLayeredImage {
  name = "rhizz";
  tag = "latest";

  # The binary and its whole /nix/store closure, plus CA certificates for
  # outbound TLS (mirrors the Dockerfile's `ca-certificates` package).
  contents = [
    rhizz
    dockerTools.caCertificates
  ];

  # Seed the VFS data dir. The server keeps a project as a plain directory of
  # HCL (see rhizz-server's storage module), so `examples/` is already a valid
  # data dir: a fresh container comes up with six editable systems and no
  # migration step. A volume mounted at /data shadows these, as it does today.
  #
  # `--no-preserve=mode,ownership` because the store copies are read-only
  # (mode 444): without it the seeded projects would be writable only by the
  # DAC-override path, and an edit in the UI would fail on the first save.
  extraCommands = ''
    mkdir -p data
    cp -r --no-preserve=mode,ownership ${examples}/. data/
  '';

  config = {
    # `rhizz web` binds RHIZZ_ADDR (default 127.0.0.1:3000); the platform
    # forwards to the container port, so bind all interfaces. The data dir
    # defaults to ./rhizz-data relative to cwd, so point it at the seed above.
    Env = [
      "RHIZZ_ADDR=0.0.0.0:8080"
      "RHIZZ_DATA_DIR=/data"
      "RUST_LOG=info"
    ];

    # Absolute path: this image is built from scratch and has no PATH to
    # search. The binary lands at /bin/rhizz (`rhizz` installs into $out/bin).
    Cmd = [ "/bin/rhizz" "web" ];

    WorkingDir = "/";

    ExposedPorts = {
      "8080/tcp" = { };
    };
  };

  meta = {
    description = "Rhizz model-based systems engineering tool (OCI image)";
    license = lib.licenses.eupl12;
    mainProgram = "rhizz";
  };
}
