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
async function openVia(kind: "files" | "commands") {
  requestPalette(kind, HOST_PROJECT_ID);
  await tick();
}

export const FileSwitcher: Story = {
  play: async ({ canvasElement }) => {
    await openVia("files");
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByRole("dialog", { name: "Go to file" }),
    ).toBeInTheDocument();
    // Off Modeling/Explore the switcher is project-scoped, so it offers
    // every file — including the docs, and the non-view file under views/.
    // The listing is read from the project when the palette opens, so these
    // wait for it rather than asserting against an empty list.
    await expect(
      await canvas.findByRole("option", { name: "main.hcl" }),
    ).toBeInTheDocument();
    await expect(
      await canvas.findByRole("option", { name: "docs/sensor.md" }),
    ).toBeInTheDocument();
  },
};

export const FileSwitcherFindsAView: Story = {
  play: async ({ canvasElement }) => {
    await openVia("files");
    const canvas = within(canvasElement);
    const input = await canvas.findByTestId("command-palette-input");
    await userEvent.type(input, "engine");
    // A nested view keeps its folder-less path, which is exactly what the
    // modeling route addresses.
    await expect(
      await canvas.findByRole("option", { name: /drone\/engine\.hcl/ }),
    ).toBeInTheDocument();
    await expect(canvas.getAllByRole("option")).toHaveLength(1);
  },
};

export const CommandPalette: Story = {
  play: async ({ canvasElement }) => {
    await openVia("commands");
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("dialog", { name: "Commands" }),
    ).toBeInTheDocument();
    await expect(canvas.getByText("Navigate")).toBeInTheDocument();
    await expect(canvas.getByText("Views")).toBeInTheDocument();
    await expect(
      canvas.getByRole("option", { name: /go to inventory/i }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("option", { name: /drone\/engine\.hcl/ }),
    ).toBeInTheDocument();
  },
};

export const EscapeCloses: Story = {
  play: async ({ canvasElement }) => {
    await openVia("commands");
    const canvas = within(canvasElement);
    await expect(await canvas.findByTestId("command-palette"))
      .toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await expect(
      canvas.queryByTestId("command-palette"),
    ).not.toBeInTheDocument();
  },
};
