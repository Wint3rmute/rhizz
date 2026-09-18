import type { Meta, StoryObj } from "@storybook/svelte";
import { expect, userEvent, waitFor, within } from "storybook/test";
import ProjectTour from "../tour/ProjectTour.svelte";
import { requestTourStart } from "../tour/tourRequest.svelte";

// Exercises the real project tour host (no demo page): each story mounts
// ProjectTour with its own project id — so an aimed request from one
// story never auto-starts another — then drives it through the request
// store exactly like the Navbar button does. Only the target-less
// welcome dialog is reachable here (later steps need real pages).
const meta = {
  title: "Onboarding/ProjectTour",
  component: ProjectTour,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof ProjectTour>;

export default meta;

type Story = StoryObj<typeof meta>;

async function startTour(canvasElement: HTMLElement, projectId: string) {
  const canvas = within(canvasElement);
  requestTourStart(projectId);
  await waitFor(async () => {
    await expect(
      canvas.getByRole("alertdialog", { hidden: false }),
    ).toBeInTheDocument();
  });
  return canvas;
}

export const OpensWelcomeAndSkips: Story = {
  args: {
    projectId: "story-skip",
  },
  play: async ({ canvasElement }) => {
    const canvas = await startTour(canvasElement, "story-skip");
    await expect(canvas.getByText("Welcome to Rhizz 👋")).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "skip tour" }));
    await waitFor(async () => {
      await expect(canvas.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
  },
};

export const ClosesViaButton: Story = {
  args: {
    projectId: "story-close",
  },
  play: async ({ canvasElement }) => {
    const canvas = await startTour(canvasElement, "story-close");
    await expect(canvas.getByText("Welcome to Rhizz 👋")).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Close tour" }));
    await waitFor(async () => {
      await expect(canvas.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
  },
};
