import type { Meta, StoryObj } from "@storybook/svelte";
import { expect, userEvent, within } from "storybook/test";
import ComponentStyleFields from "./ComponentStyleFields.svelte";

// Every story here is `no-vrt`. How these fields *look* is already covered
// by the Modeling node inspector's own baselines, which render this
// component inside the full panel; what nothing covers is what it *emits*,
// the patch protocol both callers depend on.

const meta = {
  title: "Components/ComponentStyleFields",
  component: ComponentStyleFields,
  tags: ["no-vrt"],
  args: {
    style: {
      full_name: "Central processing unit for flight stabilization",
      icon: "microchip",
      color: "primary",
      border: "solid",
      font: "unstyled",
    },
    onchange: () => {},
  },
} satisfies Meta<typeof ComponentStyleFields>;

export default meta;

type Story = StoryObj<typeof meta>;

// Module scope, so the handler can be handed in through `args` and read back
// after the interactions. The values live with the parent, so what is worth
// asserting is the *request*, not the prop.
const emitted: Record<string, unknown>[] = [];
const record = (patch: Record<string, unknown>): void => {
  emitted.push(patch);
};

/**
 * The selects emit the explicit default when reset, not an absent value:
 * `undefined` means "untouched" on the wire, so a reset spelled that way
 * would leave the old value in the file. Each emits one attribute and nothing
 * else, which is what lets both callers merge patches without stale reads.
 */
export const ResetsSendExplicitDefaults: Story = {
  args: {
    style: { color: "warning", border: "dashed", font: "bold" },
    onchange: record,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const color = canvas.getByLabelText(/^color$/i);
    const border = canvas.getByLabelText(/^border$/i);
    const font = canvas.getByLabelText(/^font$/i);
    await expect(color).toHaveValue("warning");

    emitted.length = 0;
    await userEvent.selectOptions(color, "default");
    await userEvent.selectOptions(border, "solid");
    await userEvent.selectOptions(font, "unstyled");

    await expect(emitted).toEqual([
      { color: "default" },
      { border: "solid" },
      { font: "unstyled" },
    ]);
  },
};

/**
 * The full name commits on blur, not per keystroke — a half-typed name must
 * not rewrite the model on every character.
 */
export const FullNameCommitsOnBlur: Story = {
  args: {
    style: {
      full_name: "BME280",
      color: "default",
      border: "solid",
      font: "unstyled",
    },
    onchange: record,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const textarea = canvas.getByLabelText(/full name/i);
    await expect(textarea).toHaveValue("BME280");

    emitted.length = 0;
    await userEvent.clear(textarea);
    await userEvent.type(textarea, "BME280 temperature sensor");
    await expect(emitted).toEqual([]);

    await userEvent.tab();
    await expect(emitted).toEqual([
      { full_name: "BME280 temperature sensor" },
    ]);
  },
};

/** Clearing the icon emits `undefined`, not `""`, for the same reason the
 * selects send their defaults. */
export const ClearedIconIsAbsent: Story = {
  args: {
    style: {
      icon: "microchip",
      color: "default",
      border: "solid",
      font: "unstyled",
    },
    onchange: record,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    emitted.length = 0;
    // By `title`, not by role: the button's only text is the glyph "✕", so
    // that -- not the title -- is its accessible name.
    await userEvent.click(canvas.getByTitle("Clear icon"));
    // `toStrictEqual`, not `toEqual`: the two differ on exactly the claim.
    // JSON drops undefined-valued keys on the way to Rust, where a missing key
    // means "leave this alone", so `{}` would silently keep the icon.
    await expect(emitted).toStrictEqual([{ icon: undefined }]);
  },
};
