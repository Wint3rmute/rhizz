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
      description: "Central processing unit for flight stabilization",
      tags: ["compute", "core"],
      color: "default",
      border: "solid",
      font: "unstyled",
      leaf: false,
      ports: [
        {
          label: "spi",
          description: "High speed sensor bus",
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
  },
} satisfies Meta<typeof NodeInspector>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {},
  globals: {
    viewport: { value: "phone" },
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
      description: "BME280 temperature sensor",
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

export const WithDocumentationButton: Story = {
  args: {
    onopendocumentation: () => {},
  },
  globals: {
    viewport: { value: "phone" },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("button", { name: "Open documentation" }),
    ).toBeInTheDocument();
  },
};
