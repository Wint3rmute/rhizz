import type { Meta, StoryObj } from "@storybook/svelte";
import { expect, userEvent, within } from "storybook/test";
import init from "rhizz";
import type { Project } from "../../../../vfs/types";
import { projectSlug } from "../../../../vfs/slug";
import {
  createProjectWithFiles,
  projectStore,
} from "../../../../ProjectState.svelte";
import ModelingPage from "./ModelingPage.svelte";
import { modelingPanes } from "./panes";

// Deterministic project id so story args can be built synchronously at
// module scope while the async seeding runs lazily from loaders.
const PANES_PROJECT_NAME = "Modeling panes story";
const PANES_PROJECT_ID = projectSlug(PANES_PROJECT_NAME);

// A minimal valid project: one system with one placed component, one view.
const PANES_SYSTEM_HCL = `project {
  name = "modeling-panes-story"
}

component "battery" {
  full_name = "Main power source"
  leaf        = true
}

system "demo" {
  full_name = "Demo system"

  instance "battery" {
    source = "battery"
  }
}
`;

const PANES_VIEWS_HCL = `view "main" {
  full_name = ""
  system      = "demo"

  node "demo/battery" {
    x          = 100
    y          = 100
    width      = 160
    height     = 100
    text_align = "center"
  }
}
`;

async function ensurePanesProject(): Promise<Project> {
  await init();
  // A previous panes story may have persisted a hidden/resized panel —
  // reset so every story opens the default workspace.
  modelingPanes.forget();
  const existing = await projectStore.listProjects();
  const stale = existing.find((candidate) => candidate.id === PANES_PROJECT_ID);
  if (stale !== undefined) {
    await projectStore.deleteProject(stale.id);
  }
  return createProjectWithFiles(
    PANES_PROJECT_NAME,
    [
      { path: "system.hcl", content: PANES_SYSTEM_HCL },
      { path: "views/main.hcl", content: PANES_VIEWS_HCL },
    ],
  );
}

const meta = {
  title: "Pages/Diagrams/Modeling Panes",
  component: ModelingPage,
  parameters: {
    layout: "fullscreen",
  },
  args: {
    projectId: PANES_PROJECT_ID,
  },
} satisfies Meta<typeof ModelingPage>;

export default meta;

type Story = StoryObj<typeof meta>;

// Both side panels open with a hide control in their header, a splitter
// beside them, and no restore rail — the default workspace.
export const PanesOpenByDefault: Story = {
  loaders: [ensurePanesProject],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const left = await canvas.findByTestId("modeling-pane-left");
    const right = canvas.getByTestId("modeling-pane-right");
    await expect(left).toBeVisible();
    await expect(right).toBeVisible();

    await expect(
      canvas.getByRole("button", { name: "Hide Inspector" }),
    ).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: "Hide Components" }),
    ).toBeVisible();
    await expect(
      canvas.getByRole("slider", { name: "Resize inspector panel" }),
    ).toBeTruthy();
    await expect(
      canvas.getByRole("slider", { name: "Resize components panel" }),
    ).toBeTruthy();

    // Rails exist but stay out of the way until a panel is hidden.
    await expect(
      canvas.getByTestId("modeling-pane-rail-left"),
    ).not.toBeVisible();
    await expect(
      canvas.getByTestId("modeling-pane-rail-right"),
    ).not.toBeVisible();
  },
};

// Hiding swaps the panel for its restore rail without unmounting it;
// restoring brings the same content back.
export const PanesHideAndRestore: Story = {
  loaders: [ensurePanesProject],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("modeling-pane-left");

    await userEvent.click(
      canvas.getByRole("button", { name: "Hide Inspector" }),
    );
    await expect(
      canvas.getByTestId("modeling-pane-left"),
    ).not.toBeVisible();
    const rail = canvas.getByTestId("modeling-pane-rail-left");
    await expect(rail).toBeVisible();
    await expect(rail.getAttribute("aria-label")).toBe("Show Inspector");
    await expect(
      canvas.getByTestId("modeling-splitter-left"),
    ).not.toBeVisible();

    await userEvent.click(rail);
    await expect(
      canvas.getByTestId("modeling-pane-left"),
    ).toBeVisible();
    // The inspector content is back, not reset: the Diagrams picker still
    // lists the open view.
    await expect(
      canvas.getByRole("button", { name: /^main\.hcl$/ }),
    ).toBeVisible();
  },
};

// Same contract on the components side: hiding swaps the tree panel for
// its rail, restoring brings the same tree back (still bound to the open
// view's system).
export const ComponentsPaneHideAndRestore: Story = {
  loaders: [ensurePanesProject],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("modeling-pane-right");

    await userEvent.click(
      canvas.getByRole("button", { name: "Hide Components" }),
    );
    await expect(
      canvas.getByTestId("modeling-pane-right"),
    ).not.toBeVisible();
    const rail = canvas.getByTestId("modeling-pane-rail-right");
    await expect(rail).toBeVisible();
    await expect(rail.getAttribute("aria-label")).toBe("Show Components");
    await expect(
      canvas.getByTestId("modeling-splitter-right"),
    ).not.toBeVisible();

    await userEvent.click(rail);
    await expect(
      canvas.getByTestId("modeling-pane-right"),
    ).toBeVisible();
    await expect(canvas.getByTestId("diagram-system-label"))
      .toHaveTextContent("system: demo");
  },
};
