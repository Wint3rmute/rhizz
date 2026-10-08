import type { Meta, StoryObj } from "@storybook/svelte";
import { expect, within } from "storybook/test";
import init from "rhizz";
import type { Project } from "../vfs/types";
import { projectSlug } from "../vfs/slug";
import {
  clearCurrentProject,
  createProjectWithMainFile,
  projectStore,
  setCurrentProject,
} from "../ProjectState.svelte";
import { openProjectFs } from "../vfs/fs";
import {
  type DiagramLayout,
  VIEW_LAYOUT_DIR,
  writeDiagramLayoutFile,
} from "../routes/projects/[id]/modeling/persistence";
import { tourSteps } from "./Tour";
import TourWalk, { type TourWalkPage } from "./TourWalk.svelte";

// One story per guided-tour stop, each mounting the real workspace page
// the stop spotlights (Navbar, Overview, Modeling, Inventory, Explore,
// Code) with the real `OnboardingTour` started at that step — so VRT
// screenshots pin the genuine card, spotlight, placement and progress
// per step, not a mock.
//
// Seeding is lazy and idempotent because top-level await in a story file
// races the vitest-addon's test registration (see Explore.stories.ts).
// The loader also sets the ProjectState singleton's current project, so
// the Navbar renders its workspace links (its `data-tour` anchors) —
/// `beforeEach`/`afterEach` drive the same singleton the app does.
const WALK_PROJECT_NAME = "Tour walk story";
const WALK_PROJECT_ID = projectSlug(WALK_PROJECT_NAME);

// Small but complete: a named project (so the overview header renders),
// two leaf components with ports, one system wiring them, and one view
// placing both nodes (so the modeling canvas and Explore have content).
const WALK_HCL = `project {
  name    = "tour-walk-demo"
  version = "0.1.0"
}

protocol "power" {
  full_name = "DC power delivery"
  roles       = ["provider", "consumer"]

  message "voltage" {
    full_name = "Current voltage reading"
    field "volts" {
      type = "float32"
      unit = "V"
    }
  }
}

component "battery" {
  full_name = "Main power source"
  leaf        = true

  port "power-out" {
    protocol = "power"
    role     = "provider"
    external = true
  }
}

component "controller" {
  full_name = "Processing hub"
  leaf        = true

  port "power-in" {
    protocol = "power"
    role     = "consumer"
    external = true
  }
}

system "demo-system" {
  full_name = "System using both definitions"

  instance "battery" {
    source = "battery"
  }

  instance "controller" {
    source = "controller"
  }

  connection "power-link" {
    from = "battery/power-out"
    to   = "controller/power-in"
  }
}
`;

const WALK_LAYOUT: DiagramLayout = {
  checked: {
    "demo-system/battery": { x: 40, y: 80, width: 150, height: 90 },
    "demo-system/controller": { x: 260, y: 80, width: 150, height: 90 },
  },
};

async function ensureWalkProject(): Promise<Project> {
  await init();
  const existing = await projectStore.listProjects();
  const project = existing.find((p) => p.id === WALK_PROJECT_ID) ??
    await createProjectWithMainFile(WALK_PROJECT_NAME, WALK_HCL);
  const fs = openProjectFs(projectStore, project.id);
  await writeDiagramLayoutFile(fs, `${VIEW_LAYOUT_DIR}/main.hcl`, WALK_LAYOUT);
  await setCurrentProject(project.id);
  return project;
}

// `beforeEach` must resolve to void: the loader above carries the seeded
// project, this only repeats the singleton write for the runner phase.
async function ensureWalkProjectVoid(): Promise<void> {
  await ensureWalkProject();
}

const STEPS = tourSteps(WALK_PROJECT_ID);

const meta = {
  title: "Tour/Walk",
  component: TourWalk,
  parameters: {
    layout: "fullscreen",
  },
  args: {
    projectId: WALK_PROJECT_ID,
  },
  loaders: [ensureWalkProject],
  beforeEach: [ensureWalkProjectVoid],
  afterEach: [clearCurrentProject],
} satisfies Meta<typeof TourWalk>;

export default meta;

type Story = StoryObj<typeof meta>;

// A play per stop asserting the tour opened on the expected card —
// proves the machine resolved the step (target mounted) instead of
// dropping into `tourInactive` (the empty-project dropout that motivated
// this file closed the whole tour as TARGET.NOT_FOUND).
function stepStory(
  page: TourWalkPage,
  stepId: string,
  title: string,
): Story {
  return {
    args: { page, projectId: WALK_PROJECT_ID, stepId },
    play: async ({ canvasElement }) => {
      const canvas = within(canvasElement);
      const dialog = canvas.getByRole("alertdialog");
      await expect(dialog).toBeVisible();
      const dialogQueries = within(dialog);
      await expect(
        dialogQueries.getByRole("heading", { name: title }),
      ).toBeVisible();
      // The Code stop mounts the real editor page: Monaco initializes
      // asynchronously (lazily imported tokenizer chunk, highlight round),
      // and tearing the story down mid-flight rejects its internal
      // highlight delayer ("Canceled") on dispose. Paint cannot be awaited
      // here — the story browser is narrower than the `sm` breakpoint, so
      // the page stacks vertically and the editor has no box — but the
      // widget still goes idle once init lands. Poll for DOM stability
      // (the VRT harness's own `waitForStableLayout` precedent) so
      // teardown never races it.
      if (page === "code") {
        const textarea = await canvas.findByLabelText("Editor content");
        const editor = textarea.closest(".monaco-editor");
        if (!editor) {
          throw new Error("the textarea should sit in a .monaco-editor");
        }
        let stable = 0;
        let previous = "";
        for (let attempt = 0; attempt < 150; attempt++) {
          const lines = editor.querySelector(".view-lines");
          const text = lines === null ? "" : lines.textContent;
          const lineCount = editor.querySelectorAll(".view-line").length;
          const current = `${String(text.length)}:${String(lineCount)}`;
          stable = current === previous ? stable + 1 : 0;
          if (stable >= 5) break;
          previous = current;
          await new Promise((resolve) => setTimeout(resolve, 100));
          if (attempt === 149) throw new Error("Monaco never went idle");
        }
      }
    },
  };
}

export const Welcome: Story = stepStory(
  "overview",
  "tour-welcome",
  "Welcome to Rhizz 👋",
);
export const Navbar: Story = stepStory("overview", "tour-navbar", "Navbar");
export const OverviewPreview: Story = stepStory(
  "overview",
  "tour-overview-preview",
  "Up next: Overview",
);
export const Overview: Story = stepStory(
  "overview",
  "tour-overview",
  "Overview",
);
export const ModelingPreview: Story = stepStory(
  "overview",
  "tour-modeling-preview",
  "Up next: Modeling",
);
export const ModelingCanvas: Story = stepStory(
  "modeling",
  "tour-diagrams-canvas",
  "Modeling: the core tool",
);
export const ModelingSidebar: Story = stepStory(
  "modeling",
  "tour-diagrams-sidebar",
  "Modeling: selection & inspector",
);
export const InventoryPreview: Story = stepStory(
  "overview",
  "tour-inventory-preview",
  "Up next: Inventory",
);
export const Inventory: Story = stepStory(
  "inventory",
  "tour-inventory",
  "Inventory",
);
export const ExplorePreview: Story = stepStory(
  "overview",
  "tour-explore-preview",
  "Up next: Explore",
);
export const Explore: Story = stepStory(
  "explore",
  "tour-explore",
  "Explore",
);
export const CodePreview: Story = stepStory(
  "overview",
  "tour-editor-preview",
  "Up next: Code",
);
export const Code: Story = stepStory("code", "tour-editor", "Code");
export const Done: Story = stepStory(
  "overview",
  "tour-done",
  "You're set 🚀",
);

// Guards the story list against drifting from the tour itself: every
// step id gets exactly one screenshot story above.
export const AllStepsCovered: Story = {
  tags: ["no-vrt"],
  args: { page: "overview", projectId: WALK_PROJECT_ID, stepId: STEPS[0]?.id },
  play: async () => {
    const stepIds = STEPS.map((step) => step.id);
    const storyIds = [
      "tour-welcome",
      "tour-navbar",
      "tour-overview-preview",
      "tour-overview",
      "tour-modeling-preview",
      "tour-diagrams-canvas",
      "tour-diagrams-sidebar",
      "tour-inventory-preview",
      "tour-inventory",
      "tour-explore",
      "tour-explore-preview",
      "tour-editor-preview",
      "tour-editor",
      "tour-done",
    ];
    await expect([...stepIds].sort()).toEqual([...storyIds].sort());
  },
};
