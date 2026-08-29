// The one place that knows a rhizz project's source files are the ones
// named "*.hcl" — everything else in ./vfs is a generic filesystem with
// no opinion about what a project even is. Built entirely on top of
// ProjectFs's public readdir/readFile, exactly like a real Node program
// gathering source files off a real directory would (mirroring how
// rhizz-core's own CLI-side file discovery globs `**/*.hcl`).
import type { ProjectFs } from "./fs";

// A single compiled source file, matching the `{ filename, content }`
// shape rhizz-core's `compile()` — and thus `CompileResultJS.compile` /
// `compile_system` in rhizz_wasm_wrapper.ts — already accepts.
export interface Source {
  filename: string;
  content: string;
}

// Reads every ".hcl" file in the project (recursively) into the
// `Source[]` shape the compiler accepts, using each file's path as its
// `filename` — so compiler diagnostics point at a real, human-meaningful
// path instead of a synthetic placeholder.
export async function readProjectSources(fs: ProjectFs): Promise<Source[]> {
  const entries = await fs.readdir(".", { recursive: true });
  const hclPaths = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith(".hcl") &&
        !entry.path.startsWith("diagrams/") &&
        !entry.path.startsWith(".git/"),
    )
    .map((entry) => entry.path);

  return Promise.all(
    hclPaths.map(async (path) => ({
      filename: path,
      content: await fs.readFile(path),
    })),
  );
}
