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

// System-bound view: with filterSystemLabel set, only that system's subtree
// is shown and the system root row itself is hidden — the view header
// already names the system, so the root would be redundant.
export const FilteredBySystem: Story = {
  args: {
    systems: [{ label: "a" }, { label: "b" }],
    components: [
      { label: "leaf-a", parent_system_index: 0 },
      { label: "composite", parent_system_index: 1 },
      { label: "child", parent_component_index: 1 },
    ],
    filterSystemLabel: "b",
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);

    // Only system b's components render; system a's leaf and both sys roots hidden.
    await expect(canvas.queryByText("leaf-a")).not.toBeInTheDocument();
    await expect(canvas.queryByText("a")).not.toBeInTheDocument();
    await expect(canvas.queryByText("b")).not.toBeInTheDocument();
    await expect(canvas.getByText("composite")).toBeInTheDocument();
    await expect(canvas.getByText("child")).toBeInTheDocument();

    // 2 component rows → 2 checkboxes.
    await expect(canvas.getAllByRole("checkbox")).toHaveLength(2);

    // Unknown system → empty tree with the shared empty message.
    // (Exercised via args update by the story runner re-render.)
    await expect(args.filterSystemLabel).toBe("b");
  },
};

export const FilteredUnknownSystem: Story = {
  args: {
    systems: [{ label: "a" }],
    components: [{ label: "leaf-a", parent_system_index: 0 }],
    filterSystemLabel: "missing",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("No components found.")).toBeInTheDocument();
  },
};
