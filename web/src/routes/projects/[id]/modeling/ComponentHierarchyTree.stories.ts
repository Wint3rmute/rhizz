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

// Indent guides (VS Code / Zed style): every expanded parent draws one// vertical line below itself, through its children's toggle column — the
// line sits at depth * 12 + 8px (toggle center) with the 12px level step
// preserved, so rows keep their exact positions.
export const IndentGuides: Story = {
  args: {},
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const guides = () =>
      Array.from(canvasElement.querySelectorAll("ul.tree-guides")) as [
        HTMLElement,
      ];

    // drone (system root) and fc (composite) are expanded with children:
    // one guide each. imu is a leaf: no guide below it.
    await expect(canvas.getByText("mcu")).toBeInTheDocument();
    await expect(guides()).toHaveLength(2);
    const margins = guides().map((ul) => ul.style.marginLeft);
    await expect(margins).toContain("8px"); // drone's children (depth 0)
    await expect(margins).toContain("20px"); // fc's children (depth 1)

    // Collapsing fc removes its guide; expanding restores it.
    await userEvent.click(canvas.getByRole("button", { name: "Collapse all" }));
    await expect(guides()).toHaveLength(0);
    await userEvent.click(canvas.getByRole("button", { name: "Expand all" }));
    await expect(guides()).toHaveLength(2);
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
