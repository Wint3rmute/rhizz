import type { Meta, StoryObj } from "@storybook/svelte";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { getWarningLevel, setWarningLevel } from "../WarningLevelState.svelte";
import WarningLevelSelect from "./WarningLevelSelect.svelte";

// The strictness control as the diagnostics bar renders it: one `<select>`,
// sized for a status strip, whose label is `sr-only` at every width.
//
// What is worth pinning is not that a `<select>` renders — it is that the
// control is *bound to the shared preset in both directions*. It has to follow
// a pick the user makes here, and it has to follow a change made anywhere else,
// because the value it edits is the same one the compiler is handed. Both
// assertions are polled, because each lands a re-render after the write and
// Storybook's `expect` does not retry on its own — an unpolled check here fails
// on a control that is working, which is how this story's first draft read a
// real update as a broken one.

const meta = {
  title: "Components/WarningLevelSelect",
  component: WarningLevelSelect,
  parameters: {
    layout: "centered",
  },
} satisfies Meta<typeof WarningLevelSelect>;

export default meta;

type Story = StoryObj<typeof meta>;

export const InTheBar: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // The level is persisted, so this story cannot assume a fresh origin — it
    // puts back the one it found, for whatever runs next.
    const initial = getWarningLevel();
    const select = canvas.getByLabelText("Strictness");
    await expect(select).toBeVisible();
    await expect(select).toHaveValue(initial);

    // The list is grouped, so opening the control says what the three words
    // mean. The group is the only child of the select: three loose options
    // would be the shape this replaced.
    const group = select.querySelector("optgroup");
    await expect(group).not.toBeNull();
    await expect(group).toHaveAttribute("label", "Strictness level");
    await expect(
      [...(group?.querySelectorAll("option") ?? [])].map((o) => o.value),
    ).toEqual(["business", "architectural", "component"]);

    await userEvent.selectOptions(select, "architectural");
    await waitFor(() => expect(select).toHaveValue("architectural"));
    // The pick reached the shared preset, which is the point: the bar and the
    // compiler read the same value.
    await expect(getWarningLevel()).toBe("architectural");

    // …and the reverse direction, so the control is not a private copy that
    // merely looks initialised.
    setWarningLevel("business");
    await waitFor(() => expect(select).toHaveValue("business"));

    setWarningLevel(initial);
    await waitFor(() => expect(select).toHaveValue(initial));
  },
};
