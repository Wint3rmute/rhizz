import type { Meta, StoryObj } from "@storybook/svelte";
import { expect, userEvent, within } from "storybook/test";
import init from "rhizz";
import type { Project } from "../../../../vfs/types";
import {
  createProjectWithMainFile,
  projectStore,
} from "../../../../ProjectState.svelte";
import {
  buttonByLabel,
  nodeOrigin,
  pinCanvasSize,
  placeCheckbox,
  placedNode,
} from "./diagramStoryCanvas";
import DiagramPage from "./+page.svelte";

// The arrow keys move the selection one step (the active snap grid) per
// press, rigidly across a multi-selection. A screenshot cannot show *where*
// something is, so these stories opt out of VRT (`no-vrt`) and assert world
// positions instead — read straight off the node's transform (and the note's
// text anchor), so no view math can blur the comparison.
//
// Deterministic project id so the meta args can be built synchronously at
// module scope while the async seeding runs lazily from loaders (same
// reasoning as DiagramPage.stories.ts).
const PROJECT_ID = "story-arrow-nudge";

/** The default snap grid — one arrow press, in world units. */
const STEP = 10;

const DEMO_HCL = `project {
  name    = "arrow-nudge"
  version = "0.1.0"
}

component "alpha" {
  leaf = true
}

component "beta" {
  leaf = true
}

system "demo" {
  full_name = "Demo system"
  instance "alpha" {
    source = "alpha"
  }
  instance "beta" {
    source = "beta"
  }
}
`;

// Recreate from scratch every run: the page seeds a diagram file on load, so
// an existing project can't be trusted to still match the fixture.
async function ensureProject(): Promise<Project> {
  await init();
  const existing = await projectStore.listProjects();
  const stale = existing.find((candidate) => candidate.id === PROJECT_ID);
  if (stale !== undefined) {
    await projectStore.deleteProject(stale.id);
  }
  return await createProjectWithMainFile(
    "Arrow nudge story",
    DEMO_HCL,
    PROJECT_ID,
  );
}

const meta = {
  title: "Pages/Diagrams/Arrow Key Nudge",
  component: DiagramPage,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["no-vrt"],
  args: {
    params: {
      id: PROJECT_ID,
    },
    data: {
      projectId: PROJECT_ID,
    },
  },
  loaders: [ensureProject],
} satisfies Meta<typeof DiagramPage>;

export default meta;
type Story = StoryObj<typeof meta>;

// Places a component on the canvas through the sidebar's checkbox (the mouse
// path a user takes first) and selects it with a plain click.
async function placeAndSelect(
  canvasElement: HTMLElement,
  label: string,
): Promise<SVGGElement> {
  await userEvent.click(placeCheckbox(canvasElement, label));
  const node = placedNode(canvasElement, label);
  await userEvent.click(node);
  await expect(
    within(canvasElement).getByTestId("node-inspector"),
  ).toBeInTheDocument();
  return node;
}

// A checkbox-placed node lands on the raw viewport center, i.e. off-grid, and
// a nudge snaps it to the grid as it moves (the same thing a snapped drag
// does) — so the expected position is the grid line, not where it started.
const onGrid = (value: number) => Math.round(value / STEP) * STEP;

export const SingleNode: Story = {
  play: async ({ canvasElement }) => {
    await pinCanvasSize(canvasElement);
    const node = await placeAndSelect(canvasElement, "alpha");
    const start = nodeOrigin(node);

    await userEvent.keyboard("{ArrowRight}");
    await userEvent.keyboard("{ArrowRight}");
    await userEvent.keyboard("{ArrowDown}");

    const moved = nodeOrigin(node);
    // Two steps right, one down, on the default 10-unit snap grid — counted
    // from the grid the first press pulled the node onto.
    await expect(moved.x - onGrid(start.x)).toBe(2 * STEP);
    await expect(moved.y - onGrid(start.y)).toBe(STEP);
  },
};

export const MultiSelectionMovesRigidly: Story = {
  play: async ({ canvasElement }) => {
    const scoped = within(canvasElement);
    await pinCanvasSize(canvasElement);
    // Two siblings (a child's moves are clamped to its parent instead). They
    // land on the same spot — the viewport center — which is fine: user-event
    // dispatches straight at the element it is given, so each node can still
    // be selected on its own.
    const alpha = await placeAndSelect(canvasElement, "alpha");
    await userEvent.click(placeCheckbox(canvasElement, "beta"));
    const beta = placedNode(canvasElement, "beta");

    // Select alpha, then shift-click beta into the same selection. This needs
    // a `setup()` session: user-event's direct API starts each call from a
    // clean keyboard state, so a held modifier would not survive into the
    // click (and a modifier descriptor inside `pointer` never reaches the
    // keyboard state the mouse events read their modifiers from).
    const user = userEvent.setup();
    await user.click(alpha);
    await user.keyboard("{Shift>}");
    await user.pointer([{ target: beta }, "[MouseLeft]"]);
    await user.keyboard("{/Shift}");
    await expect(scoped.getByText("2 components selected.")).toBeVisible();

    const alphaStart = nodeOrigin(alpha);
    const betaStart = nodeOrigin(beta);
    await userEvent.keyboard("{ArrowRight}");

    const alphaMoved = nodeOrigin(alpha);
    const betaMoved = nodeOrigin(beta);
    // Counted from the grid the first press pulled each node onto (both were
    // placed on the raw viewport center — see onGrid).
    await expect(alphaMoved.x - onGrid(alphaStart.x)).toBe(STEP);
    await expect(betaMoved.x - onGrid(betaStart.x)).toBe(STEP);
    // Rigid: the same delta for both, so the offset between them is unchanged.
    await expect((betaMoved.x - alphaMoved.x) - (betaStart.x - alphaStart.x))
      .toBe(0);
    await expect((betaMoved.y - alphaMoved.y) - (betaStart.y - alphaStart.y))
      .toBe(0);
  },
};

export const SelectedNote: Story = {
  play: async ({ canvasElement }) => {
    const scoped = within(canvasElement);
    await pinCanvasSize(canvasElement);
    // Snapping off: a note spawned at the viewport center starts off-grid,
    // and with snapping on the first press would also pull it onto the grid.
    // Off, the step is a plain 10 units — the documented default interval.
    await userEvent.click(buttonByLabel(canvasElement, "Snap to Grid"));
    await userEvent.keyboard("n");

    const note = await scoped.findByText("New note");
    // `N` focuses the note's editor; click the note so the canvas (not a text
    // field) has focus, the way a mouse user would before nudging. The note's
    // text is `pointer-events: none` — its hit box (the transparent rect) is
    // what a click lands on.
    const hitBox = note.closest("g")?.querySelector("rect");
    if (!hitBox) throw new Error("note has no hit box");
    await userEvent.click(hitBox);
    // Re-queried every time: the canvas keys its notes by position, so moving
    // one swaps in a brand new <text> and a captured reference would go stale.
    const anchor = () => {
      const text = scoped.getByText("New note").closest("text");
      return Number(text?.getAttribute("x") ?? Number.NaN);
    };

    const start = anchor();
    await userEvent.keyboard("{ArrowRight}");

    await expect(anchor() - start).toBe(STEP);
  },
};
