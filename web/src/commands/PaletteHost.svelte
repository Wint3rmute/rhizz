<script lang="ts">
// Where the two palettes are actually assembled and wired to the keyboard.
// It mounts in the project layout, which is what makes "only with a project
// open" true for free: outside a project there is no project to switch
// files within, and the host is not there to be asked.
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
  type PaletteKind,
} from "../components/palette/commandPalette";
import { projectStore } from "../ProjectState.svelte";
import { openProjectFs } from "../vfs/fs";
import type { Dirent } from "../vfs/fs";
import { paletteCommands } from "./commandItems";
import {
  fileSwitcherItems,
  readProjectEntries,
  type SwitcherScope,
  switcherScopeForPath,
  switcherTargetFor,
  viewPaths,
} from "./fileSwitcher";
import { getPaletteRequest } from "./paletteRequest.svelte";
import { WORKSPACE_PAGES } from "./workspacePages";

let { projectId }: { projectId: string } = $props();

const PALETTE_KINDS: readonly PaletteKind[] = ["files", "commands"];

// null = closed. One palette at a time: the two are alternatives, and
// stacking two dialogs would leave two inputs fighting over Escape.
let openKind = $state<PaletteKind | null>(null);
let entries = $state<Dirent[]>([]);
let loading = $state(false);

// Which files are worth offering depends on the page; it is re-read on
// every navigation rather than captured at mount, because the host outlives
// every page inside it.
let scope = $derived(switcherScopeForPath(page.url.pathname));

let fileItems = $derived(fileSwitcherItems(entries, scope));

let commandItems = $derived(
  paletteCommands(viewPaths(entries), {
    onPage: (pageId) => {
      closePalette();
      const target = WORKSPACE_PAGES.find((p) => p.id === pageId);
      if (target !== undefined) void goto(target.href(projectId));
    },
    onView: (view) => {
      closePalette();
      void goto(
        resolve("/projects/[id]/modeling/[...view]", { id: projectId, view }),
      );
    },
  }),
);

// The listing is read fresh on every open rather than kept in step with the
// filesystem: a file created on the Code page and the palette opened on the
// very next keystroke must not race, and a stale list is a palette that
// navigates to a file that is no longer there.
//
// `toggle` distinguishes the two callers. The chord toggles — pressing it
// again is the obvious way to dismiss a palette you opened by muscle
// memory. A button press does not: clicking the button that opened the
// palette should not be a second way to close it.
async function openPalette(
  kind: PaletteKind,
  { toggle = false }: { toggle?: boolean } = {},
): Promise<void> {
  if (toggle && openKind === kind) {
    closePalette();
    return;
  }
  openKind = kind;
  loading = true;
  try {
    entries = await readProjectEntries(openProjectFs(projectStore, projectId));
  } catch {
    // An unreadable project still opens its palette; an empty list is a
    // truthful answer and beats a dialog that never appears.
    entries = [];
  }
  loading = false;
}

function closePalette(): void {
  openKind = null;
}

function handleSelect(item: PaletteItem): void {
  if (openKind !== "files") return;
  // A row's label is exactly the path it addresses (see fileSwitcherItems).
  const target = switcherTargetFor(item.label, scope);
  closePalette();
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
  const { generation, kind, projectId: target } = getPaletteRequest();
  // Recorded even when the request names another project: a host that
  // mounted afterwards must not pick up a request it was never aimed at.
  if (generation === lastHandledRequest) return;
  lastHandledRequest = generation;
  if (kind === null || target !== projectId) return;
  void openPalette(kind);
});

// Registered on the capture phase on purpose. Monaco binds Ctrl/Cmd-P to
// its own quick-open and stops the event from bubbling out of the editor,
// so a window listener in the bubble phase would silently not fire whenever
// the HCL editor has focus — which is exactly where a file switcher is most
// wanted. Taking the chord here means the app-level palette wins, and
// Monaco keeps its symbol search on Ctrl-Shift-O.
onMount(() => {
  const onKeyDown = (event: KeyboardEvent) => {
    for (const kind of PALETTE_KINDS) {
      if (!isPaletteShortcut(event, kind)) continue;
      event.preventDefault();
      event.stopPropagation();
      void openPalette(kind, { toggle: true });
      return;
    }
  };
  window.addEventListener("keydown", onKeyDown, { capture: true });
  return () => {
    window.removeEventListener("keydown", onKeyDown, { capture: true });
  };
});

interface PaletteCopy {
  title: string;
  placeholder: string;
  empty: string;
}

// The file switcher says what it is offering, because on Modeling and
// Explore the rows are views while the chord is still "Go to file" — a
// palette titled with the wrong noun reads as broken.
function fileCopy(currentScope: SwitcherScope): PaletteCopy {
  return currentScope === "views"
    ? {
      title: "Go to view",
      placeholder: "Search this project's views…",
      empty: "No matching views",
    }
    : {
      title: "Go to file",
      placeholder: "Search this project's views and files…",
      empty: "No matching files",
    };
}

const COMMAND_COPY: PaletteCopy = {
  title: "Commands",
  placeholder: "Type a command…",
  empty: "No matching commands",
};

let copy = $derived(openKind === "commands" ? COMMAND_COPY : fileCopy(scope));
</script>

<CommandPalette
  isOpen={openKind !== null}
  items={openKind === "commands" ? commandItems : fileItems}
  kind={openKind ?? "commands"}
  title={openKind === null ? "" : copy.title}
  placeholder={openKind === null ? "" : copy.placeholder}
  emptyMessage={openKind === null ? "" : copy.empty}
  {loading}
  onselect={handleSelect}
  onclose={closePalette}
/>
