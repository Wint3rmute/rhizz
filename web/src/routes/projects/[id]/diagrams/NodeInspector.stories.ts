import type { Meta, StoryObj } from "@storybook/svelte";
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
      components: [],
      connections: [],
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
      leaf: true,
      ports: [],
      components: [],
      connections: [],
    },
  },
  globals: {
    viewport: { value: "phone" },
  },
};
