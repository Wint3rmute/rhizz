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
    // The source row sits under the full name box, not up by the component
    // path: it is part of the identity block (name -> full name -> what this
    // was instantiated from), read top to bottom like the fields above it.
    await expect(
      canvas.getByLabelText(/full name/i).compareDocumentPosition(
        canvas.getByTestId("component-source"),
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
