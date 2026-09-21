// The one place that knows a rhizz project's source files are the ones
// named "*.hcl" — everything else in ./vfs is a generic filesystem with
// no opinion about what a project even is. Built entirely on top of
// ProjectFs's public readdir/readFile, exactly like a real Node program
// gathering source files off a real directory would (mirroring how
// rhizz-core's own CLI-side file discovery globs `**/*.hcl`).
import type { Dirent, ProjectFs } from "./fs";

// A single compiled source file, matching the `{ filename, content }`
// shape rhizz-core's `compile()` — and thus `CompileResultJS.compile` /
// `compile_system` in rhizz_wasm_wrapper.ts — already accepts.
export interface Source {
  filename: string;
  content: string;
}

// Reads every ".hcl" file plus every Markdown file under `docs/`
// (recursively) into the `Source[]` shape the compiler accepts, using each
// file's path as its `filename` — so compiler diagnostics point at a real,
// human-meaningful path instead of a synthetic placeholder.
//
// Diagram layouts under `diagrams/` are included: `rhizz-core::compile`
// classifies them by path and validates each one independently (E016/E006/
// W016), exactly like the CLI and book preprocessor. View errors never clear
// the resolved model, so the model and canvas keep working.
//
// Doc files under `docs/` are never parsed — the compiler checks their
// presence by filename only (W018) — but they must be included so the check
// sees them.
export async function readProjectSources(fs: ProjectFs): Promise<Source[]> {
  const entries = await fs.readdir(".", { recursive: true });
  const sourcePaths = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        !entry.path.startsWith(".git/") &&
        (entry.name.endsWith(".hcl") || isDocsSource(entry.path)),
    )
    .map((entry) => entry.path);

  return Promise.all(
    sourcePaths.map(async (path) => ({
      filename: path,
      content: await fs.readFile(path),
    })),
  );
}

/// Mirrors `rhizz_core::is_docs_source`: a `.md` file under a `docs/`
/// directory (e.g. `docs/motor.md`). Kept in sync by hand — the compiler is
/// the authority, this only decides which files to hand it.
export function isDocsSource(path: string): boolean {
  if (!path.endsWith(".md")) return false;
  return path.split("/").includes("docs");
}

// Preference order for "which root-level .hcl file holds the system model".
// A bare "project.hcl" only carries project metadata, so it must never shadow
// a real system file just because it sorts earlier.
const PRIMARY_HCL_CANDIDATES = [
  "system.hcl",
  "systems.hcl",
  "main.hcl",
  "project.hcl",
];

// Picks the file model mutations should be written to, out of a recursive
// project listing: the first preferred candidate present, else the first
// root-level ".hcl" file (diagram layouts under `diagrams/` are view data,
// never the model), else `fallback`.
export function primaryHclPath(
  entries: Dirent[],
  fallback = "main.hcl",
): string {
  const candidates = entries.filter((entry) =>
    entry.isFile() &&
    entry.name.endsWith(".hcl") &&
    !entry.path.startsWith("diagrams/")
  );
  const preferred = PRIMARY_HCL_CANDIDATES
    .map((name) => candidates.find((entry) => entry.name === name))
    .find((entry) => entry !== undefined);
  return preferred?.path ?? candidates[0]?.path ?? fallback;
}
