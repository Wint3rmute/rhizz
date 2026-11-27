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

// Ports listed under their component, after its subcomponents: a role dot,
// a smaller muted label and an eye toggle that shows/hides the port in the
// open view. A port a drawn connection uses is locked on; ports of an
// unplaced component are disabled.
const PORTS = {
  0: [
    { label: "uart", role: "provider" as const, protocol: "serial" },
    { label: "debug", role: "peer" as const },
  ],
  1: [{ label: "spi", role: "consumer" as const, protocol: "spi" }],
  2: [{ label: "i2c", role: "provider" as const, protocol: "i2c" }],
};

// Behaviour only: the Modeling page and tour baselines already show port rows.
export const PortRows: Story = {
  tags: ["no-vrt"],
  args: {
    // fc and mcu placed; imu not.
    isChecked: (index: number) => index !== 2,
    portsOf: (index: number) => PORTS[index as keyof typeof PORTS],
    portState: (index: number, label: string) => {
      if (index === 2) return "unplaced";
      if (label === "uart") return "connected";
      if (label === "spi") return "shown";
      return "hidden";
    },
    onTogglePort: fn(),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);

    // Port toggles are buttons, not checkboxes: only the 3 component rows
    // carry a placement checkbox.
    await expect(canvas.getAllByRole("checkbox")).toHaveLength(3);

    const toggle = (label: string) =>
      canvas.getByRole("button", { name: `Show port ${label}` });
    await expect(toggle("uart")).toHaveAttribute("aria-pressed", "true");
    await expect(toggle("uart")).toBeDisabled();
    await expect(toggle("spi")).toHaveAttribute("aria-pressed", "true");
    await expect(toggle("debug")).toHaveAttribute("aria-pressed", "false");
    await expect(toggle("i2c")).toBeDisabled();

    // Hovering a port's role dot says it is a port.
    await expect(
      canvas.getByTitle("Port uart (provider, serial)"),
    ).toHaveAttribute("data-testid", "port-role-dot");

    await userEvent.click(toggle("debug"));
    await expect(args.onTogglePort).toHaveBeenLastCalledWith(0, "debug");

    // A port's label selects the component that owns it.
    await userEvent.click(canvas.getByText("spi"));
    await expect(args.onSelectComponent).toHaveBeenLastCalledWith(1);
  },
};

// System-bound view: with filterSystemLabel set, only that system's subtree
// is shown and the system root row itself is hidden — the view header
// already names the system, so the root would be redundant.
export const FilteredBySystem: Story = {
  tags: ["no-vrt"],
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
  tags: ["no-vrt"],
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

/**
 * Locked by someone else (no toggle/delete callbacks): checkboxes render
 * disabled but still show placement, the trash button is gone, and row
 * clicks still select.
 */
export const Readonly: Story = {
  tags: ["no-vrt"],
  args: {
    onToggleChecked: undefined,
    onDeleteComponent: undefined,
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);

    // Placement still visible, but no checkbox is interactive.
    const boxes = canvas.getAllByRole("checkbox");
    await expect(boxes).toHaveLength(3);
    for (const box of boxes) await expect(box).toBeDisabled();

    // No deletion affordance at all, even on hover.
    await userEvent.hover(canvas.getByText("imu"));
    await expect(
      canvas.queryByLabelText("Delete component imu"),
    ).not.toBeInTheDocument();

    // Row clicks still select — read-only navigation.
    await userEvent.click(canvas.getByText("imu"));
    await expect(args.onSelectComponent).toHaveBeenLastCalledWith(2);
  },
};
