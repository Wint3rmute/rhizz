import type { Meta, StoryObj } from "@storybook/svelte";
import { tick } from "svelte";
import { expect, userEvent, within } from "storybook/test";
import {
  clearCurrentProject,
  createProjectWithMainFile,
  populateProjectFiles,
  projectStore,
  setCurrentProject,
} from "../ProjectState.svelte";
import { openProjectFs } from "../vfs/fs";
import { projectSlug } from "../vfs/slug";
import { requestPalette } from "./paletteRequest.svelte";
import PaletteHost from "./PaletteHost.svelte";

// The host is the only place the two palettes are wired to a real project,
// a real URL and the keyboard — so these stories drive the real host rather
// than the shell's fixtures. The listing it offers is the project's actual
// files, which is the part worth pinning: a file created on the Code page
// must be switchable to on the next keystroke.
//
// Seeding is lazy and idempotent because top-level await in a story file
// races the vitest-addon's test registration (see Explore.stories.ts).

const HOST_PROJECT_NAME = "Palette Host Story Project";
// Derived the way the app derives it (vfs/slug), so seeding can look the
// project up by the same rule.
const HOST_PROJECT_ID = projectSlug(HOST_PROJECT_NAME);

const SYSTEM_HCL = `project {
  name = "palette-host-story"
}

component "sensor" {
  full_name = "Reads the world"
  leaf      = true
}

system "demo" {
  instance "sensor" {
    source = "sensor"
  }
}
`;

// A nested view, so the row's path-vs-prefix handling is exercised rather
// than a flat `views/main.hcl` that would look right by accident.
const FILES = [
  {
    path: "views/main.hcl",
    content: 'view "main" {\n  system = "demo"\n}\n',
  },
  {
    path: "views/drone/engine.hcl",
    content: 'view "engine" {\n  system = "demo"\n}\n',
  },
  { path: "docs/sensor.md", content: "# sensor\n" },
  { path: "views/notes.md", content: "not a view\n" },
];

async function ensureHostProject(): Promise<void> {
  const existing = await projectStore.listProjects();
  if (!existing.some((p) => p.id === HOST_PROJECT_ID)) {
    const project = await createProjectWithMainFile(
      HOST_PROJECT_NAME,
      SYSTEM_HCL,
    );
    await populateProjectFiles(openProjectFs(projectStore, project.id), FILES);
  }
  await setCurrentProject(HOST_PROJECT_ID);
}

const meta = {
  title: "Commands/PaletteHost",
  component: PaletteHost,
  parameters: { layout: "fullscreen" },
  args: { projectId: HOST_PROJECT_ID },
  beforeEach: [ensureHostProject],
  afterEach: [clearCurrentProject],
} satisfies Meta<typeof PaletteHost>;

export default meta;
type Story = StoryObj<typeof meta>;

// Opens through the same signal the navbar's button raises, because that is
// the path with the most moving parts between them. Awaiting a tick lets the
// request reach the host before the story starts querying: the signal is
// module-global, so `find*` below would otherwise be waiting on a dialog
// that this story's own request has not raised yet.
async function openVia() {
  requestPalette(HOST_PROJECT_ID);
  await tick();
}

export const CommandsAndFilesInOneList: Story = {
  play: async ({ canvasElement }) => {
    await openVia();
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByRole("dialog", { name: "Go to" }),
    ).toBeInTheDocument();
    // One palette, one list: the page commands and the project's files are
    // both reachable from the same search box. The listing is read from the
    // project when the palette opens, so these wait for it rather than
    // asserting against a half-filled list.
    await expect(
      await canvas.findByRole("option", { name: /go to inventory/i }),
    ).toBeInTheDocument();
    await expect(
      await canvas.findByRole("option", { name: "main.hcl" }),
    ).toBeInTheDocument();
    await expect(
      await canvas.findByRole("option", { name: "docs/sensor.md" }),
    ).toBeInTheDocument();
    // Both groups are drawn, so the list reads as "both of these" rather
    // than as one list that happens to contain some files.
    await expect(canvas.getByText("Navigate")).toBeInTheDocument();
    await expect(canvas.getByText("Files")).toBeInTheDocument();
    // And the entities section is not: this is not the inventory page.
    await expect(canvas.queryByText("Inventory")).not.toBeInTheDocument();
  },
};

export const CommandsComeFirst: Story = {
  play: async ({ canvasElement }) => {
    await openVia();
    const canvas = within(canvasElement);
    // The commands are the more common answer to "go to", and Enter on an
    // untouched palette should do the most likely thing — not open whichever
    // file sorts first.
    const rows = await canvas.findAllByRole("option");
    await expect(rows[0]).toHaveTextContent("Go to Overview");
  },
};

// Modeling and Explore both draw diagrams, so there the palette offers
// diagrams and nothing else: a row for the system file would open text
// where the user asked for a canvas.
export const DiagramsOnlyOnModeling: Story = {
  args: { pathname: "/projects/p/modeling/main.hcl" },
  play: async ({ canvasElement }) => {
    await openVia();
    const canvas = within(canvasElement);
    // Exact names: the page commands are always offered alongside whatever
    // the file section holds, so this is about which *files* appear.
    await expect(
      await canvas.findByRole("option", { name: "views/drone/engine.hcl" }),
    ).toBeInTheDocument();
    await expect(
      await canvas.findByRole("option", { name: "views/main.hcl" }),
    ).toBeInTheDocument();
    // The fixture's root system file and its doc are not diagrams.
    await expect(
      canvas.queryByRole("option", { name: "main.hcl" }),
    ).not.toBeInTheDocument();
    await expect(
      canvas.queryByRole("option", { name: "docs/sensor.md" }),
    ).not.toBeInTheDocument();
    // The section is named for what it lists.
    await expect(canvas.getByText("Views")).toBeInTheDocument();
    await expect(canvas.queryByText("Files")).not.toBeInTheDocument();
  },
};

export const FindsAView: Story = {
  args: { pathname: "/projects/p/modeling/main.hcl" },
  play: async ({ canvasElement }) => {
    await openVia();
    const canvas = within(canvasElement);
    const input = await canvas.findByTestId("command-palette-input");
    await userEvent.type(input, "engine");
    // A view is a file now, so it is found by its project path — and
    // opening it lands on the canvas, not in the text editor.
    await expect(
      await canvas.findByRole("option", { name: "views/drone/engine.hcl" }),
    ).toBeInTheDocument();
    await expect(canvas.getAllByRole("option")).toHaveLength(1);
  },
};

// Inventory gets the model's own definitions alongside the files: the page
// is about entities, so they are the thing worth searching there. Kept as
// two stories so each baseline shows one state — this one the three
// sections side by side, which is the thing a screenshot can actually pin.
export const InventorySectionOnInventory: Story = {
  args: { pathname: "/projects/p/inventory" },
  play: async ({ canvasElement }) => {
    await openVia();
    const canvas = within(canvasElement);
    // The fixture declares one top-level definition. Anchored, because the
    // row's accessible name includes its full name ("sensor Reads the
    // world") and "docs/sensor.md" in the files section also holds "sensor".
    await expect(
      await canvas.findByRole("option", { name: /^sensor\b/ }),
    ).toBeInTheDocument();
    await expect(canvas.getByText("Inventory")).toBeInTheDocument();
    // All three sections at once: the commands, the files, and the
    // entities — the palette is one list, not three palettes.
    await expect(canvas.getByText("Navigate")).toBeInTheDocument();
    await expect(canvas.getByText("Files")).toBeInTheDocument();
  },
};

export const InventoryFindsByFullName: Story = {
  args: { pathname: "/projects/p/inventory" },
  play: async ({ canvasElement }) => {
    await openVia();
    const canvas = within(canvasElement);
    const input = await canvas.findByTestId("command-palette-input");
    // A definition's full name is searchable but is not its label — which
    // is the whole reason the row carries a `hint` for it.
    await userEvent.type(input, "reads the world");
    await expect(
      await canvas.findByRole("option", { name: /^sensor\b/ }),
    ).toBeInTheDocument();
    await expect(canvas.getAllByRole("option")).toHaveLength(1);
  },
};

// Stories share one module instance, so a request raised by an earlier story
// is still live when a later one mounts — which would open a palette on
// mount. Every play therefore opens the palette it asserts about, so
// whatever state it starts in, it ends in the right one. (There is
// consequently no "closed by default" story here: the shell's own stories
// cover the closed state.)
export const EscapeCloses: Story = {
  play: async ({ canvasElement }) => {
    await openVia();
    const canvas = within(canvasElement);
    await expect(await canvas.findByTestId("command-palette"))
      .toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await expect(
      canvas.queryByTestId("command-palette"),
    ).not.toBeInTheDocument();
  },
};
