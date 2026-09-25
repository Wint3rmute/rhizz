import type { Meta, StoryObj } from "@storybook/svelte";
import { expect, userEvent, within } from "storybook/test";
import ContextMenu from "./ContextMenu.svelte";

const meta = {
  title: "Diagrams/ContextMenu",
  component: ContextMenu,
  args: {
    x: 120,
    y: 80,
    items: [
      { label: "Hide from this view", shortcut: "H", action: () => {} },
      { label: "Jump to documentation", shortcut: "O", action: () => {} },
      { label: "Jump to detailed view", shortcut: "V", action: () => {} },
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
