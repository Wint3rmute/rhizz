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
          tags: ["bus"],
          messages: [
            {
              label: "reading",
              description: "IMU raw telemetry",
              fields: [
                {
                  label: "accel_x",
                  type: "float32",
                  description: "X acceleration",
                  unit: "g",
                  required: true,
                },
              ],
            },
          ],
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
