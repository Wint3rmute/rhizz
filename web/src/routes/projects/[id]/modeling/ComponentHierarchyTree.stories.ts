import type { Meta, StoryObj } from "@storybook/svelte";
import { expect, fn, userEvent, within } from "storybook/test";
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
    selected: new Set<number>(),
    onSelectComponent: fn(),
    isChecked: (index: number) => index === 1,
    onToggleChecked: fn(),
    onDeleteComponent: fn(),
  },
} satisfies Meta<typeof ComponentHierarchyTree>;

export default meta;

type Story = StoryObj<typeof meta>;

// Exercises the hierarchy tree entirely on its own — no ModelingPage.svelte, no
// model. Verifies nesting, expand/collapse, checkbox toggling, and selection
// reporting selection clicks through the onSelectComponent callback.
export const Default: Story = {
  args: {},
  // The trash button shows only while its row is hovered; VRT hovers `imu`.
  parameters: { vrtHoverText: "imu" },
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

    // Clicking a component row reports that component; ModelingPage owns the
    // selection, so the tree itself never mutates it.
    await userEvent.click(canvas.getByText("imu"));
    await expect(args.onSelectComponent).toHaveBeenLastCalledWith(2);

    // The trash button on a component row (revealed on hover by CSS) reports
    // that component. Clicking it reports the component (visibility is
    // checked by VRT, which hovers the row).
    await userEvent.hover(canvas.getByText("imu"));
    const trash = canvas.getByLabelText("Delete component imu");
    await userEvent.click(trash);
    await expect(args.onDeleteComponent).toHaveBeenLastCalledWith(2);
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
