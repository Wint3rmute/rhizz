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
import { getProjectModel } from "../ProjectModel.svelte";
import type { Dirent } from "../vfs/fs";
import { commandItems } from "./commandItems";
import { editorTargetFor, fileItems, fileTargetFor } from "./fileSwitcher";
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

// The compiled model is shared with the status bar and the pages (see
// ProjectModel.svelte) — the palette reads its raw payload for the Inventory
// section, so the two can never disagree about what a definition is.
const projectModel = getProjectModel();

// Which page you are on decides what is worth offering — the diagrams on
// Modeling, every file on Code, and on Inventory the model's own definitions
// with no files at all. Re-read on every navigation rather than captured at
// mount, because the host outlives every page inside it.
let scope = $derived(paletteScopeForPath(pathname));
// Whether the page is Code. A file row's destination depends on it (see
// handleSelect), so it is read off the pathname the same way scope is.
let onCodePage = $derived(pathname.split("/")[3] === "code");

const FILES_GROUP = "Files";
const VIEWS_GROUP = "Views";

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
  ...(scope.inventory && projectModel.raw !== undefined
    ? inventoryItems(inventoryEntities(projectModel.raw), (label) => {
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
    const fs = projectModel.fs;
    entries = scope.files === "none" || fs === null
      ? []
      : await fs.readdir(".", { recursive: true });
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
  // A file row is just a path. Where it lands depends on the page: on Code
  // every file is text, so every row opens in the editor; elsewhere a view
  // opens on the canvas.
  const target = onCodePage
    ? editorTargetFor(item.label)
    : fileTargetFor(item.label);
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
