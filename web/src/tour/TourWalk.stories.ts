import type { Meta, StoryObj } from "@storybook/svelte";
import { expect, within } from "storybook/test";
import { tourSteps } from "./Tour";
import TourWalk from "./TourWalk.svelte";

// One story per guided-tour stop: the harness mounts static chrome for
// every `data-tour` anchor and starts the real `OnboardingTour` at that
// step, so VRT screenshots each of the fourteen stops (dialog card,
// spotlight, placement, progress) without clicking through the app.
//
// No loaders/seeding: the harness is fully static, so the static
// Storybook build VRT captures renders exactly what the browser tests
// assert below.
const STEPS = tourSteps("story-project");

const meta = {
  title: "Tour/Walk",
  component: TourWalk,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof TourWalk>;

export default meta;

type Story = StoryObj<typeof meta>;

// A play per stop asserting the tour opened on the expected card —
// proves the machine resolved the step (target mounted) instead of
// dropping into `tourInactive` (the empty-project dropout that motivated
// this file closed the whole tour as TARGET.NOT_FOUND).
function stepStory(stepId: string, title: string): Story {
  return {
    args: { stepId },
    play: async ({ canvasElement }) => {
      const canvas = within(canvasElement);
      const dialog = canvas.getByRole("alertdialog");
      await expect(dialog).toBeVisible();
      const dialogQueries = within(dialog);
      await expect(
        dialogQueries.getByRole("heading", { name: title }),
      ).toBeVisible();
    },
  };
}

export const Welcome: Story = stepStory("tour-welcome", "Welcome to Rhizz 👋");
export const Navbar: Story = stepStory("tour-navbar", "Navbar");
export const OverviewPreview: Story = stepStory(
  "tour-overview-preview",
  "Up next: Overview",
);
export const Overview: Story = stepStory("tour-overview", "Overview");
export const ModelingPreview: Story = stepStory(
  "tour-modeling-preview",
  "Up next: Modeling",
);
export const ModelingCanvas: Story = stepStory(
  "tour-diagrams-canvas",
  "Modeling: the core tool",
);
export const ModelingSidebar: Story = stepStory(
  "tour-diagrams-sidebar",
  "Modeling: selection & inspector",
);
export const InventoryPreview: Story = stepStory(
  "tour-inventory-preview",
  "Up next: Inventory",
);
export const Inventory: Story = stepStory("tour-inventory", "Inventory");
export const ExplorePreview: Story = stepStory(
  "tour-explore-preview",
  "Up next: Explore",
);
export const Explore: Story = stepStory("tour-explore", "Explore");
export const CodePreview: Story = stepStory(
  "tour-editor-preview",
  "Up next: Code",
);
export const Code: Story = stepStory("tour-editor", "Code");
export const Done: Story = stepStory("tour-done", "You're set 🚀");

// Guards the story list against drifting from the tour itself: every
// step id gets exactly one screenshot story above.
export const AllStepsCovered: Story = {
  tags: ["no-vrt"],
  args: { stepId: STEPS[0]?.id },
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
