import type { Meta, StoryObj } from "@storybook/svelte";
import { expect, userEvent, within } from "storybook/test";
import ComponentStyleFields from "./ComponentStyleFields.svelte";

// Every story here is `no-vrt`, and that is the point of this file.
//
// How these fields *look* is already covered: the Modeling node inspector
// renders this component inside the full panel, and its `Default`, `Styled`
// and `AtomicLeaf` stories carry baselines for both themes. A story of the
// bare component would screenshot the same five controls in the same two
// states, for two more LFS-tracked PNGs each, to catch a change the
// inspector's baselines catch anyway.
//
// What is not covered anywhere is what the component *emits* — the patch
// protocol its two callers both depend on. These stories run and assert
// that, and cost no baseline.

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

// Module scope, so the recording handler can be handed to the component
// through `args` and read back after the interactions. The style values live
// with the parent — it writes the model and feeds the result back — so what
// is worth asserting here is the *request*, not the prop.
const emitted: Record<string, unknown>[] = [];
const record = (patch: Record<string, unknown>): void => {
  emitted.push(patch);
};

/**
 * What the selects emit when reset.
 *
 * The explicit default (`"default"`, `"solid"`, `"unstyled"`), not an absent
 * value: `undefined` means "untouched" on the wire, so a reset spelled that
 * way would leave the old value in the file with nothing on screen showing it
 * was cleared. `border` needs no separate reset option for the same reason it
 * is a closed enum — `"solid"` already renders as no dash array.
 *
 * Each select emits one attribute and nothing else, which is what lets the two
 * pages merge patches into the model without reading stale values.
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
 * The full name is committed on blur, not per keystroke: a half-typed name
 * must not rewrite the model on every character. This pins both halves of
 * that — nothing is emitted while typing, and the whole value is emitted
 * once on blur rather than a per-character diff.
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

/** Clearing the icon emits `undefined`, not `""` — the same reason the
 * selects send their defaults: an empty string is a value the model has to
 * interpret, and the icon field is meant to be absent when unset. */
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
    // `toStrictEqual`, not `toEqual`: this is the whole claim, and the two
    // differ on exactly it. The patch is JSON-serialized on its way to Rust,
    // which drops undefined-valued keys — and there a missing key means "leave
    // this attribute alone", so `{}` would silently keep the icon.
    await expect(emitted).toStrictEqual([{ icon: undefined }]);
  },
};
