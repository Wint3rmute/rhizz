import type { Meta, StoryObj } from "@storybook/svelte";
import AnnotationInspector from "./AnnotationInspector.svelte";
import { expect, within } from "storybook/test";

const meta = {
  title: "Diagrams/AnnotationInspector",
  component: AnnotationInspector,
  args: {
    annotation: {
      text: "Carries **raw** events",
      x: 120,
      y: 80,
      scale: 1,
    },
    ontexteditstart: () => {},
    ontextcommitted: () => {},
    onscaleeditstart: () => {},
    onscalechange: () => {},
    onscalecommitted: () => {},
  },
} satisfies Meta<typeof AnnotationInspector>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {},
  globals: {
    viewport: { value: "phone" },
  },
};

export const ScaledMarkdown: Story = {
  args: {
    annotation: {
      text: "# Ingest path\n\n- fast\n- slow",
      x: 40,
      y: 200,
      scale: 2,
    },
  },
  globals: {
    viewport: { value: "phone" },
  },
};

/**
 * Locked by someone else: the text and scale stay readable, but neither
 * the textarea nor the number input accepts edits.
 */
export const Readonly: Story = {
  args: {
    readonly: true,
  },
  globals: {
    viewport: { value: "phone" },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByDisplayValue("Carries **raw** events"),
    ).toBeInTheDocument();
    await expect(canvas.getByTestId("annotation-text-input")).toBeDisabled();
    await expect(canvas.getByTestId("annotation-scale-input")).toBeDisabled();
  },
};
