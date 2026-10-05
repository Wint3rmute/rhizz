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
  icon      = "microchip"
  leaf      = true
}

component "pump" {
  full_name = "Moves fluid"
  leaf      = true
}

system "demo" {
  instance "sensor" {
    source = "sensor"
  }

  instance "pump" {
    source = "pump"
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

// Inventory gets the model's own definitions and the page switches, and no
// files: the page is about entities, so those are the two answers it can
// give, and a file row is a third thing to search that lands the user on
// some other page. Kept as two stories so each baseline shows one state —
// this one the untouched list, which is the thing a screenshot can pin.
export const InventorySectionOnInventory: Story = {
  args: { pathname: "/projects/p/inventory" },
  play: async ({ canvasElement }) => {
    await openVia();
    const canvas = within(canvasElement);
    // The fixture declares one top-level definition. Anchored, because the
    // row's accessible name includes its full name ("Go to component sensor
    // Reads the world").
    await expect(
      await canvas.findByRole("option", { name: /^go to component sensor\b/i }),
    ).toBeInTheDocument();
    // And its system: the fixture binds views to "demo", which Inventory
    // opens on the Systems tab.
    await expect(
      await canvas.findByRole("option", { name: /^go to system demo\b/i }),
    ).toBeInTheDocument();
    // Two sections, not three: the commands and the entities. The files are
    // gone entirely, so the heading they were drawn under is gone too.
    await expect(canvas.getByText("Navigate")).toBeInTheDocument();
    await expect(canvas.getByText("Inventory")).toBeInTheDocument();
    await expect(canvas.queryByText("Files")).not.toBeInTheDocument();
    // And no file row survives in their place — not the system model, not the
    // diagrams the user can still reach from Modeling, and not the doc that
    // sits one folder away from the definition it shadows.
    await expect(
      canvas.queryByRole("option", { name: /^(views\/|system\.hcl|docs\/)/ }),
    ).not.toBeInTheDocument();
  },
};

// A definition's own icon, drawn where the page commands draw their glyph —
// and a definition with none, which keeps the slot so the list's left edge
// stays straight. Both halves are here because the list is only convincing
// when they sit next to each other: one filled slot is a decoration, a filled
// slot beside an empty one is the alignment this is protecting.
export const ComponentIconsOnInventory: Story = {
  args: { pathname: "/projects/p/inventory" },
  play: async ({ canvasElement }) => {
    await openVia();
    const canvas = within(canvasElement);
    // The fixture's `sensor` declares `icon = "microchip"`; its `pump`
    // declares none.
    const sensor = await canvas.findByRole("option", {
      name: /^go to component sensor\b/i,
    });
    const pump = await canvas.findByRole("option", {
      name: /^go to component pump\b/i,
    });
    // Drawn inside the glyph slot rather than beside the label, which is what
    // "the same style as the ruler in front of Go to Modeling" means — the
    // emoji rows above are in that same column.
    const drawn = sensor.querySelector('span[aria-hidden="true"] > svg');
    await expect(drawn).toBeInTheDocument();
    // The definition without an icon keeps the slot and draws nothing in it:
    // no stand-in glyph, which would be drawing a component row as something
    // it is not, and no missing slot, which would leave its label a word-width
    // to the left of every other row in the list.
    const empty = pump.querySelector('span[aria-hidden="true"]');
    await expect(empty).toBeInTheDocument();
    await expect(empty?.children).toHaveLength(0);
    await expect(empty).toHaveClass("w-5");
    // And the icon stays out of the row's accessible name, so the palette is
    // still searched and announced by the words on it.
    await expect(sensor).toHaveTextContent("Go to component sensor");
  },
};

export const InventoryFindsEntitiesNotFiles: Story = {
  args: { pathname: "/projects/p/inventory" },
  play: async ({ canvasElement }) => {
    await openVia();
    const canvas = within(canvasElement);
    const input = await canvas.findByTestId("command-palette-input");
    // "sensor" is both the definition's label and its doc file's name, so
    // this is the search that used to answer with two rows — one of them a
    // documentation file the user has to go elsewhere to read.
    await userEvent.type(input, "sensor");
    const rows = await canvas.findAllByRole("option");
    await expect(rows).toHaveLength(1);
    await expect(rows[0]).toHaveTextContent("Go to component sensor");
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
      await canvas.findByRole("option", {
        name: /^go to component sensor\b/i,
      }),
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
