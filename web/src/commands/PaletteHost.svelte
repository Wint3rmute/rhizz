<script lang="ts">
// Where the palette is assembled and wired to the keyboard. It mounts in the
// project layout, which is what makes "only with a project open" true for
// free: outside a project there is no project to switch files within, and
// the host is not there to be asked.
//
// This is the only layer that knows about routes. It reads the project
// listing, turns it into rows with ../commands, and turns a chosen row back
// into a URL. The shell it renders (../components/palette/CommandPalette)
// knows none of that.
import { goto } from "$app/navigation";
import { resolve } from "$app/paths";
import { page } from "$app/state";
import { onMount } from "svelte";
import CommandPalette from "../components/palette/CommandPalette.svelte";
import {
  isPaletteShortcut,
  type PaletteItem,
} from "../components/palette/commandPalette";
import type { RawModelPayload } from "../modelView";
import { projectStore } from "../ProjectState.svelte";
import { getWarningLevel } from "../WarningLevelState.svelte";
import { compile_system } from "../rhizz_wasm_wrapper";
import { readProjectSources, type Source } from "../vfs/compile";
import { openProjectFs } from "../vfs/fs";
import type { Dirent } from "../vfs/fs";
import { commandItems } from "./commandItems";
import { fileItems, fileTargetFor } from "./fileSwitcher";
import { inventoryEntities, inventoryItems } from "./inventoryItems";
import { getPaletteRequest } from "./paletteRequest.svelte";
import { paletteScopeForPath } from "./paletteScope";
import { WORKSPACE_PAGES } from "./workspacePages";

// `pathname` defaults to the live route and is never passed by the app. It
// exists because what the palette offers depends on which page you are on,
// and a story is not on one: without this the scoped sections (diagrams on
// Modeling, entities on Inventory) would be unreachable outside a browser
// driving real routes. Same kind of seam as Navbar's `isOpen`.
let {
  projectId,
  pathname = page.url.pathname,
}: { projectId: string; pathname?: string } = $props();

let open = $state(false);
let entries = $state<Dirent[]>([]);
// The model, read only once the palette has actually needed it — see `show`.
// Null means "not read yet", which is also the standing state on every page
// that does not offer the inventory section.
let modelSources = $state<Source[] | null>(null);

// Which page you are on decides what is worth offering — the diagrams on
// Modeling, every file on Code, and on Inventory the model's own definitions
// with no files at all. Re-read on every navigation rather than captured at
// mount, because the host outlives every page inside it.
let scope = $derived(paletteScopeForPath(pathname));

const FILES_GROUP = "Files";
const VIEWS_GROUP = "Views";

// The model, compiled the same way every page compiles it (see
// readProjectSources / compile_system) and read as the same raw payload
// Inventory reads, so the two can never disagree about what a definition is.
// Undefined when the project does not compile — which leaves the section
// empty rather than wrong.
function model(sources: Source[]): RawModelPayload | undefined {
  const compiled = compile_system(sources, getWarningLevel()).model();
  return compiled === undefined
    ? undefined
    : (compiled.to_js() as RawModelPayload);
}

// Compiled on its own rather than inline in `items`, because a compile is the
// expensive half of opening this palette and must not be repeated every time
// the page changes. `items` reads `scope`, so an inline compile would re-run
// on each navigation for a payload that had not changed. This derived reads
// only the sources and the warning level, so it recompiles exactly when the
// model it describes has — `items` may read `scope` freely without that
// costing a recompile.
let inventoryModel = $derived(
  modelSources === null ? undefined : model(modelSources),
);

// Commands first, then the page's files, then (on Inventory) its entities.
// That is the order of the questions the palette answers — "where can I
// go?", "where is that file?", "where is that thing?" — and it means Enter
// on an untouched palette does the most common thing rather than opening
// whichever row happens to sort first.
let items = $derived([
  ...commandItems((pageId) => {
    const target = WORKSPACE_PAGES.find((page) => page.id === pageId);
    if (target !== undefined) void goto(target.href(projectId));
  }),
  ...fileItems(entries, scope).map<PaletteItem>((item) => ({
    ...item,
    // Named for what is actually listed, since on Modeling and Explore that
    // is diagrams and nothing else. The `none` scope produces no rows at
    // all, so there is no heading to name there.
    group: scope.files === "views" ? VIEWS_GROUP : FILES_GROUP,
  })),
  ...(scope.inventory && inventoryModel !== undefined
    ? inventoryItems(inventoryEntities(inventoryModel), (label) => {
      void goto(
        resolve("/projects/[id]/inventory/[...label]", {
          id: projectId,
          label,
        }),
      );
    })
    : []),
]);

// The listing is read fresh on every open rather than kept in step with the
// filesystem: a file created on the Code page and the palette opened on the
// very next keystroke must not race, and a stale list is a palette that
// navigates to a file that is no longer there.
//
// It is read only where there are file rows to fill. Inventory's scope asks
// for no files, so there is nothing to list and nothing to pay for — and the
// listing is cleared rather than left, so walking Inventory → Code cannot
// show the rows of a page that has not been read yet.
//
// `toggle` distinguishes the two callers. The chord toggles — pressing it
// again is the obvious way to dismiss a palette you opened by muscle
// memory. A button press does not: clicking the button that opened the
// palette should not be a second way to close it.
async function show(
  { toggle = false }: { toggle?: boolean } = {},
): Promise<void> {
  if (toggle && open) {
    close();
    return;
  }
  open = true;
  try {
    const fs = openProjectFs(projectStore, projectId);
    entries = scope.files === "none"
      ? []
      : await fs.readdir(".", { recursive: true });
    // Compiling is the expensive half, and only the inventory section needs
    // it — so it is read only when that section is on offer, and kept for
    // afterwards so reopening the palette on the same page is instant. This
    // is a second compile on top of the status bar's; both are per-open and
    // neither blocks anything the user is waiting on.
    if (scope.inventory && modelSources === null) {
      modelSources = await readProjectSources(fs);
    }
  } catch {
    // An unreadable project still opens its palette; an empty list is a
    // truthful answer and beats a dialog that never appears.
    entries = [];
  }
}

function close(): void {
  open = false;
}

// The one place that closes. It used to be closed here *and* again inside
// each row's own action, which meant every command and entity row closed
// twice — harmless, but it left the rule ambiguous: is closing this handler's
// job or the row's? It is the handler's, because a file row has no action at
// all and still has to close.
//
// Closing before the action runs (rather than after) also means the palette
// is already gone by the time navigation starts, so a slow `goto` cannot
// leave a stale palette on screen over the page it is navigating to.
function handleSelect(item: PaletteItem): void {
  close();
  // A command row carries its own action (it knows its page); a file row is
  // just a path, and its destination follows from what the file is.
  if (item.action !== undefined) {
    item.action();
    return;
  }
  const target = fileTargetFor(item.label);
  if (target.kind === "view") {
    void goto(
      resolve("/projects/[id]/modeling/[...view]", {
        id: projectId,
        view: target.view,
      }),
    );
    return;
  }
  // The code page reads the file to open off `?file=` and falls back to the
  // first .hcl when the param names nothing it has.
  void goto(
    `${resolve("/projects/[id]/code", { id: projectId })}?file=${
      encodeURIComponent(target.path)
    }`,
  );
}

// A palette opened from the navbar's button (the root layout) rather than
// from the keyboard.
let lastHandledRequest = 0;
$effect(() => {
  const { generation, projectId: target } = getPaletteRequest();
  // Recorded even when the request names another project: a host that
  // mounted afterwards must not pick up a request it was never aimed at.
  if (generation === lastHandledRequest) return;
  lastHandledRequest = generation;
  if (target !== projectId) return;
  void show();
});

// Registered on the capture phase on purpose. Monaco binds Ctrl/Cmd-P to
// its own quick-open and stops the event from bubbling out of the editor,
// so a window listener in the bubble phase would silently not fire whenever
// the HCL editor has focus — which is exactly where a file switcher is most
// wanted. Taking the chord here means the app-level palette wins, and
// Monaco keeps its symbol search on Ctrl-Shift-O.
onMount(() => {
  const onKeyDown = (event: KeyboardEvent) => {
    if (!isPaletteShortcut(event)) return;
    event.preventDefault();
    event.stopPropagation();
    void show({ toggle: true });
  };
  window.addEventListener("keydown", onKeyDown, { capture: true });
  return () => {
    window.removeEventListener("keydown", onKeyDown, { capture: true });
  };
});
</script>

<CommandPalette
  isOpen={open}
  {items}
  title="Go to"
  placeholder="Search files and commands…"
  emptyMessage="No matching files or commands"
  onselect={handleSelect}
  onclose={close}
/>
