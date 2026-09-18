import type { Meta, StoryObj } from "@storybook/svelte";
import { expect, userEvent, waitFor, within } from "storybook/test";
import WalkthroughPage from "../routes/walkthrough/+page.svelte";

// Demo page for the Zag-powered onboarding tour: a mock workspace with a
// 5-step tour. Plays drive the tour through the "Start tour" button (not
// the first-visit auto-start, which depends on localStorage state shared
// across stories) and prove it advances, spotlights targets and dismisses.
//
// Note: Zag labels action buttons via aria-label ("next step", "skip
// tour", ...), which overrides the visible text for accessible-name
// queries — so plays query those names, then assert the visible labels.
const meta = {
  title: "Onboarding/Walkthrough",
  component: WalkthroughPage,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof WalkthroughPage>;

export default meta;

type Story = StoryObj<typeof meta>;

async function startTour(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await userEvent.click(canvas.getByTestId("start-tour"));
  await waitFor(async () => {
    await expect(
      canvas.getByRole("alertdialog", { hidden: false }),
    ).toBeInTheDocument();
  });
  return canvas;
}

export const AdvanceToSpotlight: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await startTour(canvasElement);
    await expect(canvas.getByText("Welcome to Rhizz 👋")).toBeInTheDocument();
    await expect(canvas.getByText("Next")).toBeInTheDocument();

    // Advance: the Projects step spotlights the mock navbar.
    await userEvent.click(canvas.getByRole("button", { name: "next step" }));
    await waitFor(async () => {
      await expect(canvas.getByText("Projects")).toBeInTheDocument();
    });
    await expect(canvas.getByTestId("demo-nav")).toBeInTheDocument();
  },
};

export const FullWalkthrough: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await startTour(canvasElement);
    // Walk every step to Done: each advance must keep the actions usable.
    // The overlay unmounts mid-transition, so re-query inside waitFor.
    const titles = [
      "Welcome to Rhizz 👋",
      "Projects",
      "Code-first model",
      "Diagrams",
      "You're set 🚀",
    ];
    for (const title of titles.slice(1)) {
      await waitFor(async () => {
        const next = canvas.getByRole("button", { name: "next step" });
        await expect(next).toBeEnabled();
      });
      await userEvent.click(canvas.getByRole("button", { name: "next step" }));
      await waitFor(async () => {
        await expect(canvas.getByText(title)).toBeInTheDocument();
      });
      // Regression: the card must be hittable — no overlay (backdrop,
      // spotlight, or a pointer-events:none placement transient) may sit
      // between the cursor and the actions.
      await waitFor(async () => {
        // Last step offers Done (shares its aria-label with the ✕
        // trigger, so query its unique visible text there).
        const action = title === "You're set 🚀"
          ? canvas.getByText("Done")
          : canvas.getByRole("button", { name: "next step" });
        const rect = action.getBoundingClientRect();
        const hit = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
        await expect(
          hit?.closest('[data-part="content"]'),
        ).not.toBeNull();
      });
    }
    // Last step offers Done (a dismiss action, aria-labelled "close tour"
    // just like the ✕ trigger — so query its unique visible text).
    const done = canvas.getByText("Done");
    await userEvent.click(done);
    await waitFor(async () => {
      await expect(canvas.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
  },
};

export const ClosedAfterSkip: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await startTour(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "skip tour" }));
    // Skipped: no dialog on screen, the mock workspace stays usable.
    await waitFor(async () => {
      await expect(canvas.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
    await expect(canvas.getByTestId("start-tour")).toBeInTheDocument();
  },
};
