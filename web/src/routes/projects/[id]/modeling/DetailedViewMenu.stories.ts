import type { Meta, StoryObj } from "@storybook/svelte";
import { expect, within } from "storybook/test";
import init from "rhizz";
import type { Project } from "../../../../vfs/types";
import { projectSlug } from "../../../../vfs/slug";
import {
  createProjectWithFiles,
  projectStore,
} from "../../../../ProjectState.svelte";
import { pinCanvasSize, placedNode } from "./diagramStoryCanvas";
import DiagramPage from "./ModelingPage.svelte";
import { modelingPanes } from "./panes";

// The node context menu offers the *detail view* of a component, and which
// of the two things it can do with that view depends on whether one already
// exists: "Jump to detailed view" when it does, "Create a detailed view"
// when it doesn't. These stories drive the real page (the menu item is built
// by the page, not by ContextMenu) over a fixture where one of two placed
// components has a detail view and the other doesn't.

const DETAIL_PROJECT_NAME = "Detail view story";
// A project's id is the slug of its name (see vfs/slug), so a story derives
// its fixture id the same way the app does — synchronously, because the meta
// args below need it at module scope.
const DETAIL_PROJECT_ID = projectSlug(DETAIL_PROJECT_NAME);

const DETAIL_SYSTEM_HCL = `project {
  name = "detail-view-story"
}

component "sensor" {
  full_name = "Reads the world"
  leaf      = true
}

component "actuator" {
  full_name = "Moves the world"
  leaf      = true
}

system "demo" {
  instance "sensor" {
    source = "sensor"
  }

  instance "actuator" {
    source = "actuator"
  }
}
`;

// One view per fixture, in the same canonical layout HCL the canvas itself
// writes (see persistence.ts's layoutToHcl). `views/main.hcl` places both
// components so either can be right-clicked; `views/actuator.hcl` is the
// detail view of `actuator`, while `sensor` deliberately has none.
function layoutHcl(
  name: string,
  nodes: readonly { node: string; x: number; y: number }[],
): string {
  const blocks = nodes
    .map(
      ({ node, x, y }) =>
        `  node "demo/${node}" {
    x          = ${String(x)}
    y          = ${String(y)}
    width      = 160
    height     = 100
    text_align = "center"
  }`,
    )
    .join("\n\n");
  return `view "${name}" {
  full_name = ""
  system      = "demo"

${blocks}
}
`;
}

async function ensureDetailProject(): Promise<Project> {
  await init();
  // A panes story may have persisted a hidden/resized panel — reset so
  // every story opens the default workspace.
  modelingPanes.forget();
  // Recreate from scratch every run: the editor seeds a view (and possibly the
  // model) on load, so an existing project can't be trusted to still match
  // the fixture below (same reasoning as OpenViewUrl.stories.ts).
  const existing = await projectStore.listProjects();
  const stale = existing.find((candidate) =>
    candidate.id === DETAIL_PROJECT_ID
  );
  if (stale !== undefined) {
    await projectStore.deleteProject(stale.id);
  }
  return await createProjectWithFiles(DETAIL_PROJECT_NAME, [
    { path: "main.hcl", content: DETAIL_SYSTEM_HCL },
    {
      path: "views/main.hcl",
      content: layoutHcl("main", [
        { node: "sensor", x: 120, y: 120 },
        { node: "actuator", x: 420, y: 300 },
      ]),
    },
    {
      path: "views/actuator.hcl",
      content: layoutHcl("actuator", [{ node: "actuator", x: 420, y: 300 }]),
    },
  ]);
}

const meta = {
  title: "Pages/Diagrams/Detail View Menu",
  component: DiagramPage,
  parameters: {
    layout: "fullscreen",
  },
  args: {
    projectId: DETAIL_PROJECT_ID,
  },
  loaders: [ensureDetailProject],
} satisfies Meta<typeof DiagramPage>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Right-clicks a placed node and scopes queries to the menu that opens. */
async function nodeMenu(canvasElement: HTMLElement, label: string) {
  await pinCanvasSize(canvasElement);
  const node = placedNode(canvasElement, label);
  node.dispatchEvent(
    new MouseEvent("contextmenu", { bubbles: true, clientX: 40, clientY: 40 }),
  );
  const menu = await within(canvasElement).findByTestId("context-menu");
  return within(menu);
}

/** No detail view yet: the row offers to create one. */
export const OffersToCreate: Story = {
  play: async ({ canvasElement }) => {
    const menu = await nodeMenu(canvasElement, "sensor");
    await expect(
      await menu.findByRole("menuitem", { name: /create a detailed view/i }),
    ).toBeInTheDocument();
    await expect(
      menu.queryByRole("menuitem", { name: /jump to detailed view/i }),
    ).toBeNull();
  },
};

/** A detail view exists: the row jumps to it instead. */
export const OffersToJump: Story = {
  play: async ({ canvasElement }) => {
    const menu = await nodeMenu(canvasElement, "actuator");
    await expect(
      await menu.findByRole("menuitem", { name: /jump to detailed view/i }),
    ).toBeInTheDocument();
    await expect(
      menu.queryByRole("menuitem", { name: /create a detailed view/i }),
    ).toBeNull();
  },
};
