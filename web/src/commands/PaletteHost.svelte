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
import { onMount } from "svelte";
import CommandPalette from "../components/palette/CommandPalette.svelte";
import {
  isPaletteShortcut,
  type PaletteItem,
} from "../components/palette/commandPalette";
import { projectStore } from "../ProjectState.svelte";
import { openProjectFs } from "../vfs/fs";
import type { Dirent } from "../vfs/fs";
import { commandItems } from "./commandItems";
import { fileItems, fileTargetFor, readProjectEntries } from "./fileSwitcher";
import { getPaletteRequest } from "./paletteRequest.svelte";
import { WORKSPACE_PAGES } from "./workspacePages";

let { projectId }: { projectId: string } = $props();

let open = $state(false);
let entries = $state<Dirent[]>([]);
let loading = $state(false);

// Commands first, then the project's files. That order is the reading order
// of the two questions the palette answers — "where can I go?" and "where
// is that thing I was told about?" — and it means Enter on an untouched
// palette does the most common thing rather than opening whichever file
// happens to sort first.
const FILES_GROUP = "Files";

let items = $derived([
  ...commandItems((pageId) => {
    close();
    const target = WORKSPACE_PAGES.find((page) => page.id === pageId);
    if (target !== undefined) void goto(target.href(projectId));
  }),
  ...fileItems(entries).map<PaletteItem>((item) => ({
    ...item,
    group: FILES_GROUP,
  })),
]);

// The listing is read fresh on every open rather than kept in step with the
// filesystem: a file created on the Code page and the palette opened on the
// very next keystroke must not race, and a stale list is a palette that
// navigates to a file that is no longer there.
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

function close(): void {
  open = false;
}

function handleSelect(item: PaletteItem): void {
  // A command row carries its own action (it knows its page); a file row is
  // just a path, and its destination follows from what the file is.
  if (item.action !== undefined) {
    close();
    item.action();
    return;
  }
  const target = fileTargetFor(item.label);
  close();
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
  {loading}
  onselect={handleSelect}
  onclose={close}
/>
