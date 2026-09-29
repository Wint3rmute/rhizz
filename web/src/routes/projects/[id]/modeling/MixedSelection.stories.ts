import type { Meta, StoryObj } from "@storybook/svelte";
import { expect, userEvent, within } from "storybook/test";
import init from "rhizz";
import type { Project } from "../../../../vfs/types";
import { projectSlug } from "../../../../vfs/slug";
import {
  createProjectWithMainFile,
  projectStore,
} from "../../../../ProjectState.svelte";
import {
  buttonByLabel,
  canvasOf,
  canvasTexts,
  centerOf,
  nodeOrigin,
  pinCanvasSize,
  placeCheckbox,
  placedNode,
  rectOf,
} from "./diagramStoryCanvas";
import DiagramPage from "./ModelingPage.svelte";

// A component and a note can be selected together — shift-click extends the
// selection across both kinds — and the operations that act on "the
// selection" then cover both: the arrow keys move them together, Delete
// removes both as one undo point.
//
// Deterministic project id so the meta args can be built synchronously at
// module scope while the async seeding runs lazily from loaders (same
// reasoning as DiagramPage.stories.ts).
const PROJECT_NAME = "Mixed selection story";
// A project's id is the slug of its name (see vfs/slug), so a story derives
// its fixture id the same way the app does — synchronously, because the meta
// args below need it at module scope.
const PROJECT_ID = projectSlug(PROJECT_NAME);

const DEMO_HCL = `project {
  name    = "mixed-selection"
  version = "0.1.0"
}

component "alpha" {
  leaf = true
}

system "demo" {
  full_name = "Demo system"
  instance "alpha" {
    source = "alpha"
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
    PROJECT_NAME,
    DEMO_HCL,
  );
}

const meta = {
  title: "Pages/Diagrams/Mixed Selection",
  component: DiagramPage,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["no-vrt"],
  args: {
    projectId: PROJECT_ID,
  },
  loaders: [ensureProject],
} satisfies Meta<typeof DiagramPage>;

export default meta;
type Story = StoryObj<typeof meta>;

// The note's hit box: its text is `pointer-events: none`, so a click has to
// land on the transparent rect behind it (as a real one does).
function noteHitBox(note: Element): Element {
  const rect = note.closest("g")?.querySelector("rect");
  if (!rect) throw new Error("note has no hit box");
  return rect;
}

// A component on the canvas and a selected note — the starting point for
// extending the selection with a shift-click. A note is selected as it
// spawns, and selecting a note drops a selected component, so the mixed
// selection is built from here: click the component, then shift-click the
// note.
async function nodeWithSelectedNote(
  canvasElement: HTMLElement,
): Promise<{
  node: SVGGElement;
  note: Element;
  user: ReturnType<
    typeof userEvent.setup
  >;
}> {
  const scoped = within(canvasElement);
  await pinCanvasSize(canvasElement);
  await userEvent.click(placeCheckbox(canvasElement, "alpha"));
  const node = placedNode(canvasElement, "alpha");
  // Click the node before the shortcut: clicking the checkbox leaves focus
  // on an <input>, where the page's shortcuts are (rightly) disarmed.
  await userEvent.click(node);
  await userEvent.keyboard("n");
  const note = await scoped.findByText("New note");
  // A `setup()` session: the direct API starts each call from a clean
  // keyboard state, so a held modifier would not survive into the click.
  // The modifier has to be pressed and released through the *keyboard* API:
  // inside `pointer` it only reaches that call's own pointer state, so a
  // `{Shift>}` there would still be held when the next key is pressed (and the
  // page's shortcuts — correctly — stay disarmed while a modifier is down).
  const user = userEvent.setup();
  await user.click(node);
  await user.keyboard("{Shift>}");
  await user.pointer([{ target: noteHitBox(note) }, "[MouseLeft]"]);
  await user.keyboard("{/Shift}");
  return { node, note, user };
}

export const DeleteRemovesBoth: Story = {
  play: async ({ canvasElement }) => {
    const { node, user } = await nodeWithSelectedNote(canvasElement);
    const texts = () => canvasTexts(canvasElement);

    await user.keyboard("{Delete}");

    await expect(texts()).not.toContain("New note");
    await expect(texts()).not.toContain("alpha");
    // …as one undo point, like any single gesture.
    await user.keyboard("{Control>}z{/Control}");
    await expect(texts()).toContain("New note");
    await expect(
      placedNode(canvasElement, "alpha").getAttribute("transform"),
    ).toBe(node.getAttribute("transform"));
  },
};

export const ArrowsMoveBoth: Story = {
  play: async ({ canvasElement }) => {
    const scoped = within(canvasElement);
    const { note, user } = await nodeWithSelectedNote(canvasElement);
    // Counted from the grid the first press pulls the off-grid note onto
    // (both were placed on the raw viewport center).
    const grid = (value: number) => Math.round(value / 10) * 10;
    const before = Number(note.closest("text")?.getAttribute("x") ?? "NaN");

    await user.keyboard("{ArrowRight}");

    // The canvas keys its notes by position, so a moved note is a brand new
    // <text> — re-query instead of holding on to the old element.
    const after = Number(
      scoped.getByText("New note").closest("text")?.getAttribute("x") ??
        "NaN",
    );
    await expect(after - grid(before)).toBe(10);
  },
};

export const DraggingTheNoteMovesBoth: Story = {
  play: async ({ canvasElement }) => {
    const { note, user } = await nodeWithSelectedNote(canvasElement);
    // Snapping off: the note path snaps its own position, the node path does
    // not, so with snapping on the two would land a few units apart and the
    // "same delta" assertion below would be measuring the grid, not the drag.
    await user.click(buttonByLabel(canvasElement, "Snap to Grid"));
    const canvas = canvasOf(canvasElement);
    const node = placedNode(canvasElement, "alpha");
    const nodeBefore = nodeOrigin(node);
    const noteBefore = rectOf(note);
    const DELTA = { x: 80, y: 40 };

    // Grab the *note*: the selection drags as a group whichever kind is
    // grabbed, and the note is the delta base here. Both the grab and the
    // move need explicit coordinates — user-event's default for a target
    // with no position yet is (0, 0), and the drag's offset is measured
    // against the grab point.
    const grab = centerOf(rectOf(noteHitBox(note)));
    await user.pointer([
      { target: noteHitBox(note), coords: grab },
      "[MouseLeft>]",
      {
        target: canvas,
        coords: { clientX: grab.x + DELTA.x, clientY: grab.y + DELTA.y },
      },
      "[/MouseLeft]",
    ]);

    // The canvas keys its notes by position, so a moved note is a brand new
    // <text> — re-query instead of holding on to the old element.
    const noteAfter = rectOf(
      within(canvasElement).getByText("New note"),
    );
    await expect(nodeOrigin(node).x - nodeBefore.x).toBe(DELTA.x);
    await expect(noteAfter.x - noteBefore.x).toBe(DELTA.x);
  },
};
