import type { Meta, StoryObj } from "@storybook/svelte";
import { expect, fn, userEvent, within } from "storybook/test";
import ContextMenu from "./ContextMenu.svelte";

// The node menu as ModelingPage builds it. The last row ("create new view from
// selection") is the only one that is about the whole selection rather than the
// node under the pointer, and so the only one without a shortcut hint.
const nodeMenuItems = [
  { label: "Hide from this view", shortcut: "H", action: fn() },
  { label: "Jump to documentation", shortcut: "O", action: fn() },
  { label: "Jump to detailed view", shortcut: "V", action: fn() },
  { label: "Create new view from selection", action: fn() },
];

const meta = {
  title: "Diagrams/ContextMenu",
  component: ContextMenu,
  args: {
    x: 120,
    y: 80,
    items: nodeMenuItems,
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

// The row is the one thing the node menu offers that has no shortcut, so this
// story is also the only place the "no `kbd`" reading is visible: the other
// three rows carry one, and this one must not borrow a neighbour's.
export const SelectionViewRowFires: Story = {
  args: {
    items: nodeMenuItems.map((item) => ({ ...item, action: fn() })),
    onclose: fn(),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const row = canvas.getByRole("menuitem", {
      name: /create new view from selection/i,
    });
    // No shortcut hint, unlike every other row in this menu.
    await expect(row.querySelector("kbd")).toBeNull();
    await userEvent.click(row);

    const items = args.items as { label: string; action: () => void }[];
    const picked = items.find(
      (item) => item.label === "Create new view from selection",
    );
    await expect(picked?.action).toHaveBeenCalledOnce();
    await expect(args.onclose as () => void).toHaveBeenCalledOnce();
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
