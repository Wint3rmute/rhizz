import type { Meta, StoryObj } from "@storybook/svelte";
import { expect, within } from "storybook/test";
import NodeInspector from "./NodeInspector.svelte";

const meta = {
  title: "Diagrams/NodeInspector",
  component: NodeInspector,
  args: {
    componentKey: "drone/flight-controller",
    component: {
      label: "flight-controller",
      full_name: "Central processing unit for flight stabilization",
      tags: ["compute", "core"],
      color: "default",
      border: "solid",
      font: "unstyled",
      leaf: false,
      ports: [
        {
          label: "spi",
          full_name: "High speed sensor bus",
          protocol: "spi",
          role: "provider",
          external: true,
          required: true,
          tags: ["bus"],
        },
      ],
    },
    textAlign: "center",
    onupdate: () => {},
    onrename: () => {},
    onsettextalign: () => {},
    ondelete: () => {},
    onopendocumentation: () => {},
  },
} satisfies Meta<typeof NodeInspector>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {},
  globals: {
    viewport: { value: "phone" },
  },
  play: async ({ canvasElement }) => {
    // A component that carries its own body has no definition to point back
    // to, so the source row stays out of the way entirely.
    await expect(
      within(canvasElement).queryByTestId("component-source"),
    ).toBeNull();
  },
};

export const Styled: Story = {
  args: {
    component: {
      ...meta.args.component,
      icon: "microchip",
      color: "#ff0000",
      border: "dashed",
      font: "bold",
    },
  },
  globals: {
    viewport: { value: "phone" },
  },
};

export const AtomicLeaf: Story = {
  args: {
    component: {
      label: "temp-sensor",
      full_name: "BME280 temperature sensor",
      tags: ["sensor"],
      color: "default",
      border: "solid",
      font: "unstyled",
      leaf: true,
      ports: [],
    },
  },
  globals: {
    viewport: { value: "phone" },
  },
};

/**
 * The split itself: attributes that live in `system.hcl` are in one panel,
 * attributes that live in the open view are in another, and each panel's
 * heading carries a hover popup naming its file.
 */
export const AttributeScopes: Story = {
  args: {},
  globals: {
    viewport: { value: "phone" },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const component = await canvas.findByTestId("component-attributes");
    const view = await canvas.findByTestId("view-attributes");

    // The component panel holds what the model owns...
    await expect(within(component).getByLabelText(/^color$/i)).toBeTruthy();
    await expect(within(component).getByLabelText(/^border$/i)).toBeTruthy();
    await expect(within(component).getByLabelText(/^font$/i)).toBeTruthy();
    // ...and not what the view owns. This is the assertion that would fail
    // if alignment ever drifted back into the shared list: it is the one
    // attribute whose two halves write to different files.
    await expect(within(component).queryByText("Text alignment")).toBeNull();

    // The view panel holds the alignment, and nothing else.
    await expect(within(view).getByText("Text alignment")).toBeTruthy();
    await expect(within(view).queryByLabelText(/^color$/i)).toBeNull();

    // Both headings say which file they write to, on hover.
    await expect(
      within(component).getByTestId("component-attributes-heading"),
    ).toHaveAttribute("data-tip", expect.stringContaining("system.hcl"));
    await expect(
      within(view).getByTestId("view-attributes-heading"),
    ).toHaveAttribute("data-tip", expect.stringContaining("views/"));
  },
};

/**
 * An instance, placed under a name of its own, cloned from a shared
 * definition: the source row links to that definition's Inventory page.
 */
export const Sourced: Story = {
  args: {
    projectId: "drone-story",
    componentKey: "drone/fc",
    component: {
      ...meta.args.component,
      label: "fc",
      source: "flight-controller",
    },
  },
  globals: {
    viewport: { value: "phone" },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // The editable name is the *instance's* name within its parent scope, not
    // the definition's — the same vocabulary CreateComponentModal already uses
    // ("Definition Name" vs "Instance Name") for this exact field.
    await expect(canvas.getByLabelText(/instance name/i)).toBeInTheDocument();
    // The source row sits directly under the name, above the full name: it
    // answers "which component is this", which is what the name above it also
    // answers, so the two read together. It used to sit below the full name
    // instead, which only worked while full_name was a sibling field here —
    // it now lives inside the shared style block, and a provenance link below
    // the border and font pickers read as a style value.
    await expect(
      canvas.getByTestId("component-source").compareDocumentPosition(
        canvas.getByLabelText(/full name/i),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Named by the definition, not by the instance's own label — the link has
    // to address the definition, so `fc` must not leak into the href.
    const link = await canvas.findByRole("link", { name: "flight-controller" });
    // `stringContaining` rather than an exact match, because Storybook
    // rewrites link hrefs inside the preview (same reason as
    // DiagramPage.stories.ts). The tail is the part under test.
    await expect(link).toHaveAttribute(
      "href",
      expect.stringContaining(
        "/projects/drone-story/inventory/flight-controller",
      ),
    );
  },
};
