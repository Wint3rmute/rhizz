import type { Meta, StoryObj } from "@storybook/svelte";
import { expect, userEvent, waitFor, within } from "storybook/test";
import init from "rhizz";
import type { Project } from "../../../../vfs/types";
import {
  createProjectWithMainFile,
  projectStore,
} from "../../../../ProjectState.svelte";
import DiagramPage from "./+page.svelte";

// Entities spawned without a position of their own — the `C`/`N` keyboard
// shortcuts — land under the pointer while it is over the canvas, and on
// the viewport center once it has left. Pointer placement is invisible in a
// screenshot, so these stories opt out of VRT (`no-vrt`) and assert the
// geometry in the play function instead.
//
// Deterministic project id so the meta args can be built synchronously at
// module scope while the async seeding runs lazily from loaders (same
// reasoning as DiagramPage.stories.ts).
const PROJECT_ID = "story-spawn-cursor";

// Size forced on the story root so the page's canvas is not squeezed to
// nothing by its sidebars, and never resizes mid-story (see measurableCanvas).
const STORY_WIDTH = "1280px";
const STORY_HEIGHT = "800px";

const DEMO_HCL = `project {
  name    = "spawn-cursor"
  version = "0.1.0"
}

component "sensor" {
  full_name = "Environmental sensor"
  leaf      = true
}

system "demo" {
  full_name = "Demo system"
  instance "sensor" {
    source = "sensor"
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
    "Spawn at cursor story",
    DEMO_HCL,
    PROJECT_ID,
  );
}

const meta = {
  title: "Pages/Diagrams/Spawn At Cursor",
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

// The canvas viewBox — `view.x view.y width/zoom height/zoom` — is what maps
// screen coordinates to world ones, so every assertion below goes through it
// and therefore holds whatever pan/zoom the view happens to be in.
function viewBoxOf(svg: SVGSVGElement): [number, number, number, number] {
  const raw = svg.getAttribute("viewBox");
  if (raw === null) throw new Error("canvas has no viewBox");
  return raw.split(/\s+/).map(Number) as [number, number, number, number];
}

function toWorld(svg: SVGSVGElement, clientX: number, clientY: number) {
  const box = svg.getBoundingClientRect();
  const [viewX, viewY, viewWidth, viewHeight] = viewBoxOf(svg);
  return {
    x: viewX + (clientX - box.left) * (viewWidth / box.width),
    y: viewY + (clientY - box.top) * (viewHeight / box.height),
  };
}

// A note's text starts at its anchor: the first line's baseline, so the
// rendered box's left/bottom edges sit on it (a font's descender hangs a
// couple of units below the baseline, hence the loose comparison).
async function expectNoteAt(
  note: Element,
  svg: SVGSVGElement,
  anchor: { x: number; y: number },
): Promise<void> {
  const box = note.getBoundingClientRect();
  const world = toWorld(svg, box.left, box.bottom);
  await expect(world.x).toBeCloseTo(anchor.x, -1);
  await expect(world.y).toBeCloseTo(anchor.y, -1);
}

function canvasOf(canvasElement: HTMLElement): SVGSVGElement {
  const canvas = canvasElement.querySelector<SVGSVGElement>(
    '[data-testid="diagram-canvas"]',
  );
  if (!canvas) throw new Error("diagram canvas not rendered");
  return canvas;
}

// The story runner's viewport is phone-sized, where the page's two w-64
// sidebars squeeze the canvas to zero width and every measurement here is
// meaningless. The story root is sized explicitly instead (the runner's own
// viewport is fixed — the mobile stories depend on it): a flex row of a
// definite size, which is what the app shell gives the page in the real app.
// Both dimensions have to be pinned, because the canvas is otherwise sized by
// its own content — mounting the note's inspector would then grow the canvas
// *after* the note was placed, and the placement (taken at the old center)
// would no longer match the center the assertion measures.
async function measurableCanvas(
  canvasElement: HTMLElement,
): Promise<SVGSVGElement> {
  const canvas = canvasOf(canvasElement);
  canvasElement.style.display = "flex";
  canvasElement.style.width = STORY_WIDTH;
  canvasElement.style.height = STORY_HEIGHT;
  // The page picks the new size up through its bound clientWidth/Height a
  // tick after the layout does; wait for the viewBox to follow, or the
  // placement below runs against a stale canvas size.
  await waitFor(async () => {
    const [, , viewWidth, viewHeight] = viewBoxOf(canvas);
    const { width, height } = canvas.getBoundingClientRect();
    await expect(viewWidth).toBeGreaterThan(0);
    await expect(Math.abs(viewWidth - width)).toBeLessThanOrEqual(1);
    await expect(Math.abs(viewHeight - height)).toBeLessThanOrEqual(1);
  });
  return canvas;
}

export const AnnotationUnderPointer: Story = {
  play: async ({ canvasElement }) => {
    const scoped = within(canvasElement);
    const canvas = await measurableCanvas(canvasElement);
    // Aim at a point well away from the viewport center, so "under the
    // pointer" can never be confused with the fallback placement.
    const box = canvas.getBoundingClientRect();
    const pointer = {
      clientX: box.left + box.width * 0.25,
      clientY: box.top + box.height * 0.7,
    };
    await userEvent.pointer([{ target: canvas, coords: pointer }]);
    await userEvent.keyboard("n");

    const note = await scoped.findByText("New note");
    await expectNoteAt(
      note,
      canvas,
      toWorld(canvas, pointer.clientX, pointer.clientY),
    );
  },
};

export const AnnotationFallsBackToCenter: Story = {
  play: async ({ canvasElement }) => {
    const scoped = within(canvasElement);
    const canvas = await measurableCanvas(canvasElement);
    const sidebar = canvasElement.querySelector("aside");
    if (!sidebar) throw new Error("inspector sidebar not rendered");
    // Both moves in one call: leaving the canvas is what drops the spawn
    // anchor, and only a continuous pointer path dispatches the mouseleave.
    // With no canvas pointer left to place under, the note lands where the
    // user is looking instead.
    const canvasBox = canvas.getBoundingClientRect();
    const sidebarBox = sidebar.getBoundingClientRect();
    await userEvent.pointer([
      {
        target: canvas,
        coords: { clientX: canvasBox.left + 10, clientY: canvasBox.top + 10 },
      },
      {
        target: sidebar,
        coords: {
          clientX: sidebarBox.left + 10,
          clientY: sidebarBox.top + 10,
        },
      },
    ]);
    await userEvent.keyboard("n");

    const note = await scoped.findByText("New note");
    const [viewX, viewY, viewWidth, viewHeight] = viewBoxOf(canvas);
    await expectNoteAt(note, canvas, {
      x: viewX + viewWidth / 2,
      y: viewY + viewHeight / 2,
    });
  },
};
