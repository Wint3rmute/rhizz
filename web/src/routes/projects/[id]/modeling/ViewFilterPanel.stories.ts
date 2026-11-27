import type { Meta, StoryObj } from "@storybook/svelte";
import { expect, fn, userEvent, within } from "storybook/test";
import ViewFilterPanel from "./ViewFilterPanel.svelte";

const meta = {
  title: "Diagrams/ViewFilterPanel",
  component: ViewFilterPanel,
  args: {
    includeTags: ["power", "video"],
    knownTags: ["motor", "power", "sensor", "video"],
    missing: [
      { key: "quad/drone/esc", label: "esc", matchedTags: ["power"] },
      { key: "quad/drone/vtx", label: "vtx", matchedTags: ["video"] },
    ],
    onchange: fn(),
  },
  globals: {
    viewport: { value: "phone" },
  },
} satisfies Meta<typeof ViewFilterPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Tag chips plus the list of matching components the view does not show. */
export const MissingComponents: Story = {};

/** Every component the filter matches is placed. */
export const Complete: Story = {
  tags: ["no-vrt"],
  args: { missing: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("filter-complete")).toBeVisible();
  },
};

/** Space confirms a chip; the chip's ✕ and Backspace remove one. */
export const AddAndRemoveTags: Story = {
  tags: ["no-vrt"],
  args: { includeTags: ["power"], missing: [] },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByLabelText("Include tags");
    await userEvent.type(input, "video ");
    await expect(args.onchange).toHaveBeenLastCalledWith(["power", "video"]);
    await expect(input).toHaveValue("");

    await userEvent.click(
      canvas.getByRole("button", { name: "Remove tag power" }),
    );
    await expect(args.onchange).toHaveBeenLastCalledWith([]);

    await userEvent.type(input, "{Backspace}");
    await expect(args.onchange).toHaveBeenLastCalledWith([]);
  },
};

/** Locked by someone else: chips stay visible but cannot be edited. */
export const Readonly: Story = {
  tags: ["no-vrt"],
  args: { readonly: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByLabelText("Include tags")).toBeDisabled();
  },
};
