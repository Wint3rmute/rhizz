import type { Meta, StoryObj } from "@storybook/svelte";
import { expect, fn, userEvent, within } from "storybook/test";
import ContextMenu from "./ContextMenu.svelte";

const meta = {
  title: "Diagrams/ContextMenu",
  component: ContextMenu,
  args: {
    x: 120,
    y: 80,
    // The node menu as ModelingPage builds it, all four rows.
    items: [
      { label: "Hide from this view", shortcut: "H", action: fn() },
      { label: "Jump to documentation", shortcut: "O", action: fn() },
      { label: "Jump to detailed view", shortcut: "V", action: fn() },
      { label: "Create new view from selection", action: fn() },
    ],
    onclose: () => {},
  },
} satisfies Meta<typeof ContextMenu>;

export default meta;

type Story = StoryObj<typeof meta>;

export const ComponentMenu: Story = {
  args: {},
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("context-menu")).toBeInTheDocument();
    await expect(canvas.getByRole("menuitem", { name: /hide from this view/i }))
      .toBeInTheDocument();
    await expect(canvas.getByText("H")).toBeInTheDocument();
    await expect(
      canvas.getByRole("menuitem", { name: /create new view from selection/i }),
    ).toBeInTheDocument();
  },
};

export const EmptyCanvasMenu: Story = {
  args: {
    items: [
      { label: "New component", shortcut: "C", action: () => {} },
      { label: "New annotation", shortcut: "N", action: () => {} },
      { label: "Zoom to fill", shortcut: "F", action: () => {} },
      { label: "Reset view", shortcut: "R", action: () => {} },
      { label: "Toggle grid", shortcut: "G", action: () => {} },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("context-menu")).toBeInTheDocument();
    await expect(canvas.getByRole("menuitem", { name: /new component/i }))
      .toBeInTheDocument();
    await expect(canvas.getByRole("menuitem", { name: /toggle grid/i }))
      .toBeInTheDocument();
  },
};

export const AnnotationMenu: Story = {
  args: {
    items: [{
      label: "Delete",
      shortcut: "Del",
      action: () => {},
      dangerous: true,
    }],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("menuitem", { name: /delete/i }))
      .toBeInTheDocument();
  },
};

export const ClickItemCloses: Story = {
  args: {},
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const item = canvas.getByRole("menuitem", { name: /hide from this view/i });
    await userEvent.click(item);
  },
};
