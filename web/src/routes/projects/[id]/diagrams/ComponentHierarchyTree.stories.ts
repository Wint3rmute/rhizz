import type { Meta, StoryObj } from "@storybook/svelte";
import { expect, fn, userEvent, within } from "storybook/test";
import { SvelteSet } from "svelte/reactivity";
import ComponentHierarchyTree from "./ComponentHierarchyTree.svelte";

const SYSTEMS = [{ label: "drone" }];
// Arena indices: 0 = fc (composite), 1 = mcu (child of fc), 2 = imu.
const COMPONENTS = [
  { label: "fc", parent_system_index: 0, icon: "microchip" },
  { label: "mcu", parent_component_index: 0 },
  { label: "imu", parent_system_index: 0 },
];

const meta = {
  title: "Diagrams/ComponentHierarchyTree",
  component: ComponentHierarchyTree,
  args: {
    systems: SYSTEMS,
    components: COMPONENTS,
    selected: new SvelteSet<number>(),
    isChecked: (index: number) => index === 1,
    onToggleChecked: fn(),
  },
} satisfies Meta<typeof ComponentHierarchyTree>;

export default meta;

type Story = StoryObj<typeof meta>;

// Exercises the hierarchy tree entirely on its own — no +page.svelte, no
// model. Verifies nesting, expand/collapse, checkbox toggling, and selection
// syncing through callback props + the selected SvelteSet.
export const Default: Story = {
  args: {},
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);

    // System is a root; its top-level components are children. The nested
    // `mcu` (child of the composite `fc`) renders collapsed-under it.
    await expect(canvas.getByText("drone")).toBeInTheDocument();
    await expect(canvas.getByText("fc")).toBeInTheDocument();
    await expect(canvas.getByText("imu")).toBeInTheDocument();
    await expect(canvas.getByText("mcu")).toBeInTheDocument();

    // 3 component rows → 3 checkbox inputs (the system root has none).
    const rows = canvas.getAllByRole("checkbox");
    await expect(rows).toHaveLength(3);

    // Toggling a checkbox fires onToggleChecked with the arena index.
    const target = rows[2];
    if (target) await userEvent.click(target); // imu (index 2), currently unchecked
    await expect(args.onToggleChecked).toHaveBeenLastCalledWith(2);

    // Selecting a component row collapses `selected` to that component.
    await userEvent.click(canvas.getByText("imu"));
    await expect(args.selected?.has(2)).toBe(true);
  },
};

export const ExpandCollapseAll: Story = {
  args: {},
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Buttons are present while there's something expandable.
    await expect(canvas.getByRole("button", { name: "Collapse all" }))
      .toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Expand all" }))
      .toBeInTheDocument();

    // "Collapse all" folds every expandable node: all top-level rows still
    // render, but their children are hidden.
    const mcu = canvas.getByText("mcu");
    await userEvent.click(canvas.getByRole("button", { name: "Collapse all" }));
    await expect(mcu).not.toBeInTheDocument();

    // "Expand all" unfolds them again.
    await userEvent.click(canvas.getByRole("button", { name: "Expand all" }));
    await expect(canvas.getByText("mcu")).toBeInTheDocument();
  },
};
