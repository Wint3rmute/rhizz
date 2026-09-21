import type { Meta, StoryObj } from "@storybook/svelte";
import {
  clearCurrentProject,
  createProjectWithMainFile,
  projectStore,
  setCurrentProject,
  setCurrentScore,
} from "../ProjectState.svelte";
import Navbar from "./Navbar.svelte";

// Deterministic project id so seeding can stay lazy (and out of module
// scope — top-level await in story files races the vitest-addon's test
// registration; see Explore.stories.ts), while staying idempotent across
// module re-evaluations.
const NAVBAR_PROJECT_ID = "story-navbar";

// The Navbar reads everything from the shared ProjectState singleton (the app
// renders `<Navbar />` with no props), so the stories drive that singleton
// rather than injecting fixtures through props: seed the project, make it the
// active one, and publish the score the badge renders.
async function ensureNavbarProject(): Promise<void> {
  const existing = await projectStore.listProjects();
  if (!existing.some((p) => p.id === NAVBAR_PROJECT_ID)) {
    await createProjectWithMainFile(
      "Navbar Story Project",
      `project { name = "Navbar Story Project" }`,
      NAVBAR_PROJECT_ID,
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
