<script lang="ts">
import { page } from "$app/state";
import { onDestroy, untrack } from "svelte";
import MonacoEditor from "../../../../components/MonacoEditor.svelte";
import { createDebounced } from "../../../../debounce";
import { getProjectModel } from "../../../../ProjectModel.svelte";
import { projectStore } from "../../../../ProjectState.svelte";
import { type Dirent, openProjectFs, type ProjectFs } from "../../../../vfs/fs";
import { TOUR_TARGETS } from "../../../../tour/tourTargets";
import Pane from "../../../../components/modular_ui/Pane.svelte";
import Splitter from "../../../../components/modular_ui/Splitter.svelte";
import {
  SIDE_PANEL_WIDTH_FRACTION,
  viewportCap,
} from "../../../../components/modular_ui/viewport";
import FileTree from "./FileTree.svelte";
import { codePanes } from "./panes";

let {
  projectId,
}: {
  projectId: string;
} = $props();

// Modular workspace layout: the file sidebar's width and hidden flag in one
// serializable store, persisted across reloads.
let layout = $state(codePanes.read());

$effect(() => {
  codePanes.write(layout);
});

let fs = $derived(openProjectFs(projectStore, projectId));

// Compiled model is shared with the status bar and the other pages; this
// page contributes the open editor's buffer as a draft so the shared model
// (and thus the bar) reflects unsaved keystrokes, while the debounced write
// persists them.
const projectModel = getProjectModel();

let entries = $state<Dirent[]>([]);
let selectedPath = $state<string | null>(null);
let loadedProjectId: string | null = null;

async function refreshEntries(): Promise<void> {
  entries = await fs.readdir(".", { recursive: true });
}

// Picks a sensible default file to open: the `?file=` query param (used by
// the modeling inspector's "Open documentation" button) wins when it names
// a real file, else the first ".hcl" file found (in practice always
// "main.hcl" for projects created via ProjectState.svelte's
// createProjectWithMainFile), or `null` if the project has no source files
// at all yet.
function firstHclPath(): string | null {
  const requested = page.url.searchParams.get("file");
  if (
    requested !== null &&
    entries.some((e) => e.isFile() && e.path === requested)
  ) {
    return requested;
  }
  return entries.find((e) => e.isFile() && e.name.endsWith(".hcl"))?.path ??
    null;
}

// (Re)loads the whole tree once per project, when the project first
// becomes available or changes identity (e.g. after switching projects).
$effect(() => {
  const id = projectId;
  if (id === loadedProjectId) return;
  loadedProjectId = id;
  selectedPath = null;
  void refreshEntries().then(() => {
    selectedPath = firstHclPath();
  });
});

// A navigation that names a file while this page is already mounted (the
// palette does this from Code) must select it. Only `page` is tracked: the
// listing and the selection are read untracked, so a refresh after a
// create/rename/delete does not snap the selection back to the URL's file.
$effect(() => {
  const requested = page.url.searchParams.get("file");
  if (requested === null) return;
  untrack(() => {
    if (entries.some((e) => e.isFile() && e.path === requested)) {
      selectedPath = requested;
    }
  });
});

let content = $state("");
let loadedPath: string | null = null;
let lastWrittenContent = "";
let fileLoaded = $state(false);

// Every write persists the whole VFS blob, so writing on every keystroke
// turned a typed sentence into one full-blob transfer per character. Trailing
// debounce instead: the write happens once the typing pauses. The `fs` handle
// and the content are captured per call, so the write that finally runs
// targets the file that was open when the burst started, with its newest text.
const WRITE_DEBOUNCE_MS = 700;
const scheduleFileWrite = createDebounced(
  (file: ProjectFs, path: string, text: string) => {
    void file.writeFile(path, text);
  },
  WRITE_DEBOUNCE_MS,
);

// Loads the selected file's content into the editor whenever the
// selection changes identity. Missing files fall back to empty content
// rather than erroring.
$effect(() => {
  const path = selectedPath;
  if (path === loadedPath) return;
  // Switching files must not swallow the tail of the previous one: its
  // pending write lands here, while we still know which file it belongs to
  // (flushing later — after the switch — would write it to the new file's
  // sibling, or resurrect a file that is about to be renamed/deleted).
  scheduleFileWrite.flush();
  loadedPath = path;
  fileLoaded = false;
  if (path === null) {
    content = "";
    lastWrittenContent = "";
    fileLoaded = true;
    return;
  }
  void fs.readFile(path)
    .catch(() => "")
    .then((loaded) => {
      if (loadedPath === path) {
        content = loaded;
        lastWrittenContent = loaded;
        fileLoaded = true;
      }
    });
});

// Navigating away (or otherwise unmounting) is the other way a pending write
// could be lost, and the last chance to flush it: the debounce timer is not
// tied to the component's lifetime.
onDestroy(() => scheduleFileWrite.flush());

// …and a full document unload (a reload, a closed tab) never runs that
// teardown at all — the timer dies with the document, taking the tail of the
// last burst with it. `pagehide` is the one hook that fires on the way out of
// *any* navigation, including reloads, and the write it starts resolves
// within the microtask drain that follows the handler, before the new document
// reads the store.
function flushFileWrite(): void {
  scheduleFileWrite.flush();
}

// Writes edits back to the store. Comparing against `lastWrittenContent`
// (rather than re-reading the file, which would need an extra round
// trip) means this only ever fires for an actual edit, never for the
// load effect's own initial assignment above. `lastWrittenContent` is updated
// optimistically, before the debounced write actually lands — it answers
// "is the editor's text already accounted for", not "is it on disk yet".
$effect(() => {
  const file = fs;
  if (fileLoaded && loadedPath !== null && content !== lastWrittenContent) {
    lastWrittenContent = content;
    // Reflect the edit in the shared model immediately, before the debounced
    // write lands, so stats and the status bar track the editor per keystroke.
    projectModel.setDraft(loadedPath, content);
    scheduleFileWrite(file, loadedPath, content);
  }
});

function reportError(error: unknown): void {
  alert(error instanceof Error ? error.message : String(error));
}

// Strips leading/trailing slashes and rejects anything containing "/" or
// only whitespace — prompt() collects a bare name (a new path segment),
// never a nested path, so a stray "/" almost certainly means the user
// meant something a plain rename/create dialog can't express here.
function sanitizeSegmentName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed === "" || trimmed.includes("/")) return null;
  return trimmed;
}

function joinPath(parentPath: string, name: string): string {
  return parentPath ? `${parentPath}/${name}` : name;
}

async function handleCreateFile(parentPath: string): Promise<void> {
  const name = sanitizeSegmentName(
    prompt("New file name?", "untitled.hcl") ?? "",
  );
  if (name === null) return;
  const path = joinPath(parentPath, name);
  try {
    await fs.writeFile(path, "");
    await refreshEntries();
    selectedPath = path;
  } catch (error) {
    reportError(error);
  }
}

async function handleCreateDirectory(parentPath: string): Promise<void> {
  const name = sanitizeSegmentName(
    prompt("New folder name?", "untitled") ?? "",
  );
  if (name === null) return;
  try {
    await fs.mkdir(joinPath(parentPath, name));
    await refreshEntries();
  } catch (error) {
    reportError(error);
  }
}

async function handleRename(path: string): Promise<void> {
  const segments = path.split("/");
  const oldName = segments[segments.length - 1];
  const parentPath = segments.slice(0, -1).join("/");
  const name = sanitizeSegmentName(prompt("Rename to?", oldName) ?? "");
  if (name === null || name === oldName) return;
  const newPath = joinPath(parentPath, name);
  // Land a pending write for this file *before* the rename, not after: a write
  // still queued when the rename lands would recreate the old path (writes
  // create files that don't exist), leaving a stray duplicate behind.
  scheduleFileWrite.flush();
  try {
    await fs.rename(path, newPath);
    if (selectedPath === path) selectedPath = newPath;
    await refreshEntries();
  } catch (error) {
    reportError(error);
  }
}

async function handleDelete(path: string): Promise<void> {
  if (!confirm(`Delete "${path}"? This can't be undone.`)) return;
  // Same reasoning as the rename: a write queued behind the delete would
  // resurrect the file the user just threw away.
  scheduleFileWrite.flush();
  try {
    await fs.rm(path, { recursive: true });
    if (selectedPath === path || selectedPath?.startsWith(`${path}/`)) {
      selectedPath = null;
    }
    await refreshEntries();
    if (selectedPath === null) selectedPath = firstHclPath();
  } catch (error) {
    reportError(error);
  }
}
</script>

<svelte:window onpagehide={flushFileWrite} />

<!-- Same modular workspace as Modeling and Inventory: a file sidebar (Pane)
     beside the main area, with the editor filling all the height down to the
     diagnostics status bar that the project layout renders below this page. -->
<div
  class="flex flex-row flex-1 w-full min-h-0 overflow-hidden bg-base-100"
  data-testid="code-workspace"
>
  <Pane
    scope="code"
    title="Files"
    side="left"
    width={layout.leftWidth}
    hidden={layout.leftHidden}
    responsive={false}
    onhide={() => (layout = codePanes.hide(layout, "left"))}
    onshow={() => (layout = codePanes.show(layout, "left"))}
  >
    <div class="flex-1 min-h-0 overflow-auto p-3">
      <FileTree
        {entries}
        bind:selectedPath
        oncreatefile={handleCreateFile}
        oncreatedirectory={handleCreateDirectory}
        onrename={handleRename}
        ondelete={handleDelete}
      />
    </div>
  </Pane>

  <Splitter
    testid="code-splitter-left"
    panelName="files"
    value={layout.leftWidth}
    hidden={layout.leftHidden}
    onresize={(dx) =>
      (layout = codePanes.resize(
        layout,
        "left",
        Math.min(
          layout.leftWidth + dx,
          viewportCap(SIDE_PANEL_WIDTH_FRACTION, "width"),
        ),
      ))}
  />

  <main class="flex flex-col flex-1 min-w-0 min-h-0 bg-base-100">
    <header
      class="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-base-300 text-base-content"
      data-tour={TOUR_TARGETS.editor}
    >
      <h1 class="flex items-baseline gap-2 min-w-0 font-semibold text-lg">
        <span>Editor</span>
        {#if selectedPath}
          <span class="text-base-content/50 font-mono text-sm truncate">
            {selectedPath}
          </span>
        {/if}
      </h1>
    </header>
    {#if selectedPath === null}
      <div
        class="flex-1 min-h-0 flex items-center justify-center text-base-content/50 text-sm"
      >
        No file selected — create or pick one from the sidebar.
      </div>
    {:else}
      <div class="flex-1 min-h-0 w-full">
        <MonacoEditor
          bind:value={content}
          language={selectedPath?.endsWith(".md") ? "markdown" : "hcl"}
          surface="base-100"
        />
      </div>
    {/if}
  </main>
</div>
