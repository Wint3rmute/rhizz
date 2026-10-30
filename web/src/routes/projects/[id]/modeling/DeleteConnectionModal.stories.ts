import type { Meta, StoryObj } from "@storybook/svelte";
import { expect, fn, userEvent, within } from "storybook/test";
import DeleteConnectionModal from "./DeleteConnectionModal.svelte";
import type { DeleteConnectionRequest } from "./deleteConnection";

const siblings: DeleteConnectionRequest = {
  label: "fc-power",
  from: { component: "battery", port: "power-out" },
  to: { component: "flight-controller", port: "power-in" },
  removablePorts: [
    { definition: "battery", port: "power-out", component: "battery" },
    {
      definition: "flight-controller",
      port: "power-in",
      component: "flight-controller",
    },
  ],
  keptPorts: [],
};

const meta = {
  title: "Diagrams/DeleteConnectionModal",
  component: DeleteConnectionModal,
  args: {
    request: siblings,
    onconfirm: fn(),
    onclose: fn(),
  },
} satisfies Meta<typeof DeleteConnectionModal>;

export default meta;

type Story = StoryObj<typeof meta>;

// Unchecked by default: only the connection goes.
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const modal = within(canvasElement);
    await expect(
      await modal.findByTestId("delete-connection-remove-ports"),
    ).not.toBeChecked();
    await expect(
      modal.getAllByTestId("delete-connection-port")[0],
    ).toHaveTextContent("Keep");
  },
};

export const PortCleanup: Story = {
  play: async ({ canvasElement }) => {
    const modal = within(canvasElement);
    await userEvent.click(
      await modal.findByTestId("delete-connection-remove-ports"),
    );
    await expect(
      modal.getAllByTestId("delete-connection-port")[0],
    ).toHaveTextContent("Will be removed");
  },
};

// A port another connection uses: it stays, and checking the box warns that
// the op will be refused.
export const SharedPort: Story = {
  args: {
    request: {
      ...siblings,
      removablePorts: [
        {
          definition: "flight-controller",
          port: "power-in",
          component: "flight-controller",
        },
      ],
      keptPorts: [
        {
          definition: "battery",
          port: "power-out",
          component: "battery",
          usedBy: ["battery-telemetry"],
        },
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const modal = within(canvasElement);
    await expect(
      await modal.findByTestId("delete-connection-kept-port"),
    ).toHaveTextContent("Used by battery-telemetry");
    await userEvent.click(modal.getByTestId("delete-connection-remove-ports"));
    // The warning sits below the fold in a short canvas; its presence and
    // wording matter, not its scroll position.
    await expect(
      await modal.findByTestId("delete-connection-port-conflict"),
    ).toHaveTextContent("still used by another connection");
  },
};
