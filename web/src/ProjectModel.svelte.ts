// The compiled state of one open project, shared by every surface inside the
// projects/[id] layout: the pages (Overview, Code, Inventory, Modeling,
// DiagramViewer) and the bottom DiagnosticsStatusBar. A single instance is
// created per project scope and handed down with `getProjectModel()` /
// `setProjectModel()` (see ProjectModelProvider.svelte), so the bar and the
// page always describe the same compile.
//
// Before this, every surface opened the project's filesystem, read the
// sources, and called `compile_system` itself (and re-read after each
// mutation), which let the bar's snapshot drift from the live page and let
// one caller (Inventory) forget the warning level entirely. Funnelling that
// through one object removes both classes of bug and the per-page plumbing.
//
// It deliberately does NOT own project metadata (that stays in
// ProjectState.svelte, which Navbar — outside this context tree — still
// reads) nor diagram layouts/docs (pages read those from `fs` themselves).
import { createContext } from "svelte";
import { SvelteMap } from "svelte/reactivity";
import type { CompileResultJS } from "rhizz";
import type { RawModelPayload } from "./modelView";
import { getWarningLevel } from "./WarningLevelState.svelte";
import { projectStore } from "./ProjectState.svelte";
import { compile_system } from "./rhizz_wasm_wrapper";
import { readProjectSources, type Source } from "./vfs/compile";
import { openProjectFs, type ProjectFs } from "./vfs/fs";

export class ProjectModel {
  /** The project this model is bound to; null before `open`. */
  projectId = $state<string | null>(null);
  /** The project's filesystem facade, or null before `open`. */
  fs = $state<ProjectFs | null>(null);
  /** True once the first read for the current project has settled. */
  ready = $state(false);

  // Sources as persisted in the VFS, and an overlay of not-yet-persisted
  // editor buffers (the Code page writes on a debounce, but its stats must
  // update per keystroke). `sources` exposes the merged view.
  private persisted = $state<Source[]>([]);
  private drafts = new SvelteMap<string, string>();

  /** The project-wide strictness preset; changing it recompiles. */
  warningLevel = $derived(getWarningLevel());

  sources = $derived.by((): Source[] => {
    if (this.drafts.size === 0) return this.persisted;
    return this.persisted.map((source) => {
      const draft = this.drafts.get(source.filename);
      return draft === undefined ? source : { ...source, content: draft };
    });
  });

  output = $derived.by((): CompileResultJS | null => {
    try {
      return compile_system(this.sources, this.warningLevel);
    } catch {
      // A crashed compile leaves `model` undefined, like a failed parse.
      return null;
    }
  });

  model = $derived(this.output?.model());
  diagnostics = $derived(this.output?.diagnostics() ?? []);
  errors = $derived(this.diagnostics.filter((d) => d.level === "Error"));
  warnings = $derived(this.diagnostics.filter((d) => d.level !== "Error"));
  components = $derived(this.model?.components() ?? []);
  connections = $derived(this.model?.connections() ?? []);
  systems = $derived(this.model?.systems() ?? []);
  score = $derived(this.model?.score());
  raw = $derived(
    this.model === undefined
      ? undefined
      : (this.model.to_js() as RawModelPayload),
  );

  private openedFor: string | null = null;

  /** Binds to `id` and loads its sources; a no-op if already open. */
  async open(id: string | null): Promise<void> {
    if (id === this.openedFor) return;
    this.openedFor = id;
    this.projectId = id;
    this.drafts.clear();
    if (id === null) {
      this.fs = null;
      this.persisted = [];
      this.ready = true;
      return;
    }
    this.ready = false;
    const fs = openProjectFs(projectStore, id);
    this.fs = fs;
    try {
      const loaded = await readProjectSources(fs);
      // A newer `open` may have resolved while we read; ignore stale results.
      if (this.projectId === id) {
        this.persisted = loaded;
        this.ready = true;
      }
    } catch {
      if (this.projectId === id) {
        this.persisted = [];
        this.ready = true;
      }
    }
  }

  /** Re-reads the persisted sources (after a mutation) — drafts are kept. */
  async reload(): Promise<void> {
    const id = this.projectId;
    const fs = this.fs;
    if (id === null || fs === null) return;
    try {
      const loaded = await readProjectSources(fs);
      if (this.projectId === id) this.persisted = loaded;
    } catch {
      if (this.projectId === id) this.persisted = [];
    }
  }

  /** Overlays an in-editor buffer over the persisted source with that name. */
  setDraft(filename: string, content: string): void {
    this.drafts.set(filename, content);
  }

  clearDraft(filename: string): void {
    this.drafts.delete(filename);
  }

  clearDrafts(): void {
    this.drafts.clear();
  }
}

// `createContext` needs Svelte ≥ 5.40. Reading it outside a provider throws,
// which is the point: a component that needs the model must be under
// ProjectModelProvider (the projects layout provides it, and Storybook's
// global decorator provides it for page stories).
export const [getProjectModel, setProjectModel] = createContext<ProjectModel>();
