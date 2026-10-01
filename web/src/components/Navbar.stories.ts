import type { Meta, StoryObj } from "@storybook/svelte";
import { expect, within } from "storybook/test";
import {
  clearCurrentProject,
  createProjectWithMainFile,
  projectStore,
  setCurrentProject,
  setCurrentScore,
} from "../ProjectState.svelte";
import { projectSlug } from "../vfs/slug";
import Navbar from "./Navbar.svelte";

// Deterministic project id so seeding can stay lazy (and out of module
// scope — top-level await in story files races the vitest-addon's test
// registration; see Explore.stories.ts), while staying idempotent across
// module re-evaluations.
const NAVBAR_PROJECT_NAME = "Navbar Story Project";
// A project's id is the slug of its name (see vfs/slug), so a story derives
// its fixture id the same way the app does — synchronously, because the meta
// args below need it at module scope.
const NAVBAR_PROJECT_ID = projectSlug(NAVBAR_PROJECT_NAME);

// The Navbar reads everything from the shared ProjectState singleton (the app
// renders `<Navbar />` with no props), so the stories drive that singleton
// rather than injecting fixtures through props: seed the project, make it the
// active one, and publish the score the badge renders.
async function ensureNavbarProject(): Promise<void> {
  const existing = await projectStore.listProjects();
  if (!existing.some((p) => p.id === NAVBAR_PROJECT_ID)) {
    await createProjectWithMainFile(
      NAVBAR_PROJECT_NAME,
      `project { name = "Navbar Story Project" }`,
    );
  }
  await setCurrentProject(NAVBAR_PROJECT_ID);
  setCurrentScore({ overall_percentage: 72.5 });
}

// Leaves no story pinned to the fixture project (or its badges).
function clearNavbarProject(): void {
  clearCurrentProject();
}

const meta = {
  title: "Components/Navbar",
  component: Navbar,
  parameters: {
    layout: "fullscreen",
  },
  beforeEach: [ensureNavbarProject],
  afterEach: [clearNavbarProject],
} satisfies Meta<typeof Navbar>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Desktop: Story = {
  parameters: {
    viewport: { defaultViewport: "responsive" },
  },
};

// The navbar only renders its workspace links, the project title, the tour
// button and the palette button when a project is open — all of it reads the
// ProjectState singleton, which no `args` can supply. `beforeEach` seeds it
// for the test runner.
//
// Opted out of VRT: the static Storybook build VRT screenshots has no
// `beforeEach`, and the loader that would stand in for it writes the state
// *after* the story has already rendered — measured, the capture shows a
// navbar with no project at all. A baseline like that would look like
// "the project-scoped controls are invisible", which is the opposite of
// what the component does. (The tour button has always been in the same
// position; the palette button joins it.)
export const ProjectOpen: Story = {
  tags: ["no-vrt"],
  parameters: {
    viewport: { defaultViewport: "responsive" },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Queried by label rather than by role: the button lives in the
    // `hidden md:flex` row and the test browser's viewport is narrower
    // than that breakpoint, so it is in the document but not in the
    // accessibility tree here. VRT honours the `viewport` parameter above
    // and captures it where it is visible.
    const button = canvas.getByLabelText("Open the command palette");
    await expect(button).toBeInTheDocument();
    // Its tooltip spells the chord the way this platform writes it — a
    // button that says "Ctrl" on a Mac teaches the wrong keystroke.
    await expect(button).toHaveAttribute(
      "title",
      "Command palette (Ctrl+Shift+P)",
    );
  },
};

export const MobileCollapsed: Story = {
  globals: {
    viewport: { value: "mobile1" },
  },
  parameters: {
    viewport: { defaultViewport: "mobile1" },
  },
  args: {
    isOpen: false,
  },
};

export const MobileExpanded: Story = {
  globals: {
    viewport: { value: "mobile1" },
  },
  parameters: {
    viewport: { defaultViewport: "mobile1" },
  },
  args: {
    isOpen: true,
  },
};
