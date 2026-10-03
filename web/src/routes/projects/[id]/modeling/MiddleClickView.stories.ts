import type { Meta, StoryObj } from "@storybook/svelte";
import { expect, userEvent, waitFor, within } from "storybook/test";
import init from "rhizz";
import type { Project } from "../../../../vfs/types";
import { projectSlug } from "../../../../vfs/slug";
import {
  createProjectWithFiles,
  projectStore,
} from "../../../../ProjectState.svelte";
import { canvasTexts, pinCanvasSize, placedNode } from "./diagramStoryCanvas";
import DiagramPage from "./ModelingPage.svelte";

// The middle mouse button over a node is the pointer's answer to the `V` key:
// it opens that component's detail view, or creates one when the component has
// none. The gesture runs the same handler the key and the context-menu row do,
// so these stories pin the *pointer path* to it — the two outcomes the shared
// handler has, over a fixture holding one component of each kind.
//
// Creating writes a file and re-reads the view list, so the row these stories
// wait for only exists a moment after the click.

const MIDDLE_CLICK_PROJECT_NAME = "Middle click view story";
// A project's id is the slug of its name (see vfs/slug), so a story derives
// its fixture id the same way the app does — synchronously, because the meta
// args below need it at module scope.
const MIDDLE_CLICK_PROJECT_ID = projectSlug(MIDDLE_CLICK_PROJECT_NAME);

const MIDDLE_CLICK_SYSTEM_HCL = `project {
  name = "middle-click-view-story"
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
// components, so the canvas visibly loses one when a view switch happens;
// `views/actuator.hcl` is the detail view of `actuator`, while `sensor`
// deliberately has none.
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

async function ensureMiddleClickProject(): Promise<Project> {
  await init();
  // Recreate from scratch every run: the editor seeds a view (and possibly the
  // model) on load, so an existing project can't be trusted to still match the
  // fixture below (same reasoning as DetailedViewMenu.stories.ts).
  const existing = await projectStore.listProjects();
  const stale = existing.find((candidate) =>
    candidate.id === MIDDLE_CLICK_PROJECT_ID
  );
  if (stale !== undefined) {
    await projectStore.deleteProject(stale.id);
  }
  return await createProjectWithFiles(MIDDLE_CLICK_PROJECT_NAME, [
    { path: "main.hcl", content: MIDDLE_CLICK_SYSTEM_HCL },
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
  title: "Pages/Diagrams/Middle Click View",
  component: DiagramPage,
  parameters: {
    layout: "fullscreen",
  },
  args: {
    projectId: MIDDLE_CLICK_PROJECT_ID,
  },
  loaders: [ensureMiddleClickProject],
} satisfies Meta<typeof DiagramPage>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Middle-clicks a placed node. Through `userEvent` rather than a synthetic
 * `MouseEvent`, so the gesture takes the same pointer path a real middle click
 * does (and a story that dispatched a plain event would pass even if the
 * handler only ever looked at `button` on something else).
 */
async function middleClickNode(
  canvasElement: HTMLElement,
  label: string,
): Promise<void> {
  await pinCanvasSize(canvasElement);
  await userEvent.pointer([
    { target: placedNode(canvasElement, label) },
    "[MouseMiddle]",
  ]);
}

/**
 * The Diagrams tree row of `path`, once the canvas is showing it. Polled
 * because both outcomes land asynchronously: creating a view writes a file and
 * re-reads the list before the row can exist at all.
 */
async function expectOpenView(
  canvasElement: HTMLElement,
  path: string,
): Promise<void> {
  // A string `name` matches the accessible name in full, which is what the
  // row needs: "sensor.hcl" must not also match a row for some other view.
  const currentOf = () =>
    within(canvasElement)
      .queryAllByRole("button", { name: path })
      .map((row) => row.getAttribute("aria-current"));
  await waitFor(() => expect(currentOf()).toContain("true"));
}

/** No detail view yet: the gesture writes one and opens it. */
export const CreatesTheView: Story = {
  play: async ({ canvasElement }) => {
    await middleClickNode(canvasElement, "sensor");

    await expectOpenView(canvasElement, "sensor.hcl");
    // `main.hcl` placed both components and the new view holds only the one
    // that was clicked, so the canvas showing only it *is* the view switch —
    // the created view also carries the node, as the `V` key's does.
    await waitFor(() => expect(canvasTexts(canvasElement)).toEqual(["sensor"]));
  },
};

/** A detail view exists: the gesture opens it instead of making another. */
export const JumpsToTheView: Story = {
  play: async ({ canvasElement }) => {
    await middleClickNode(canvasElement, "actuator");

    await expectOpenView(canvasElement, "actuator.hcl");
    await waitFor(() =>
      expect(canvasTexts(canvasElement)).toEqual(["actuator"])
    );
  },
};
