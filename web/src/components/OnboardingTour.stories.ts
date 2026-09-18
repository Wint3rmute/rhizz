import type { Meta, StoryObj } from "@storybook/svelte";
import { expect, userEvent, waitFor, within } from "storybook/test";
import TourDemoMock from "./TourDemoMock.svelte";

// Full tour coverage against the mock workspace: every anchor exists
// locally, so the play walks all nine stops (step navigation no-ops in
// Storybook). Each story uses its own project id so an aimed request
// never auto-starts a sibling story.
const meta = {
  title: "Onboarding/ProjectTour",
  component: TourDemoMock,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof TourDemoMock>;

export default meta;

type Story = StoryObj<typeof meta>;

async function startTour(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await userEvent.click(canvas.getByTestId("tour-start"));
  await waitFor(async () => {
    await expect(
      canvas.getByRole("alertdialog", { hidden: false }),
    ).toBeInTheDocument();
  });
  return canvas;
}

export const FullTour: Story = {
  args: {
    projectId: "story-full",
  },
  play: async ({ canvasElement }) => {
    const canvas = await startTour(canvasElement);
    await expect(canvas.getByText("Welcome to Rhizz 👋")).toBeInTheDocument();
    const titles = [
      "Navbar",
      "System Overview",
      "Diagrams: the core tool",
      "Diagrams: selection & inspector",
      "Inventory",
      "Explore",
      "Editor",
      "You're set 🚀",
    ];
    for (const title of titles) {
      // The overlay unmounts mid-transition, so re-query inside waitFor.
      await waitFor(async () => {
        const next = canvas.getByRole("button", { name: "next step" });
        await expect(next).toBeEnabled();
      });
      await userEvent.click(canvas.getByRole("button", { name: "next step" }));
      await waitFor(async () => {
        const dialog = canvas.getByRole("alertdialog", { hidden: false });
        await expect(within(dialog).getByText(title)).toBeInTheDocument();
      });
    }
    // Last stop offers Done (shares its aria-label with the ✕ trigger,
    // so query its unique visible text), then the mock still stands.
    await userEvent.click(canvas.getByText("Done"));
    await waitFor(async () => {
      await expect(canvas.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
    await expect(canvas.getByTestId("mock-toolbar")).toBeInTheDocument();
  },
};

export const SkipsEarly: Story = {
  args: {
    projectId: "story-skip",
  },
  play: async ({ canvasElement }) => {
    const canvas = await startTour(canvasElement);
    await expect(canvas.getByText("Welcome to Rhizz 👋")).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "skip tour" }));
    await waitFor(async () => {
      await expect(canvas.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
    await expect(canvas.getByTestId("tour-start")).toBeInTheDocument();
  },
};
