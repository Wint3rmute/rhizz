import type { Meta, StoryObj } from "@storybook/svelte";
import { expect, fn, userEvent, within } from "storybook/test";
import type { ProtocolData } from "../../../../modelView";
import NewConnectionModal from "./NewConnectionModal.svelte";
import type { NewConnectionRequest } from "./newConnection";

function protocol(
  label: string,
  roles: string[],
  full_name = "",
): ProtocolData {
  return {
    label,
    full_name,
    tags: [],
    roles,
    leaf: false,
    encapsulates: [],
    messages: [],
  };
}

const protocols: ProtocolData[] = [
  protocol("can", ["peer"], "Controller Area Network"),
  protocol("spi", ["provider", "consumer"], "Serial Peripheral Interface"),
  protocol("uart", []),
];

// Two siblings of one system: the plain case the dialog is built for.
const siblings: NewConnectionRequest = {
  scopePath: "quadcopter",
  from: {
    key: "quadcopter/battery",
    label: "battery",
    component: "battery",
    definition: "battery",
    portLabels: [],
  },
  to: {
    key: "quadcopter/flight-controller",
    label: "flight-controller",
    component: "flight-controller",
    definition: "flight-controller",
    portLabels: [],
  },
};

// The listed protocol option containing `text`.
async function protocolOption(
  root: HTMLElement,
  text: string,
): Promise<HTMLElement> {
  const options = await within(root).findAllByTestId(
    "new-connection-protocol-option",
  );
  const found = options.find((option) => option.textContent.includes(text));
  if (found === undefined) throw new Error(`no protocol option “${text}”`);
  return found;
}

const meta = {
  title: "Diagrams/NewConnectionModal",
  component: NewConnectionModal,
  args: {
    request: siblings,
    protocols,
    protocolUsage: new Map([["spi", 4]]),
    takenConnectionLabels: ["gps-link"],
    oncreate: fn(),
    onclose: fn(),
  },
} satisfies Meta<typeof NewConnectionModal>;

export default meta;

type Story = StoryObj<typeof meta>;

// Everything prefilled: Enter creates with these.
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const modal = within(canvasElement);
    const line = await modal.findByTestId("new-connection-preview-line");
    await expect(line).toHaveAttribute("stroke-dasharray", "6 4");
  },
};

export const ProtocolPicker: Story = {
  play: async ({ canvasElement }) => {
    const modal = within(canvasElement);
    await userEvent.click(await modal.findByTestId("new-connection-protocol"));
    // Used protocols come first.
    const options = await modal.findAllByTestId(
      "new-connection-protocol-option",
    );
    await expect(options[0]).toHaveTextContent("spi");
  },
};

export const ProtocolWithRoles: Story = {
  play: async ({ canvasElement }) => {
    const modal = within(canvasElement);
    await userEvent.click(await modal.findByTestId("new-connection-protocol"));
    await userEvent.click(await protocolOption(canvasElement, "spi"));
    await expect(modal.getByTestId("new-connection-from-role")).toHaveValue(
      "provider",
    );
    await expect(modal.getByTestId("new-connection-to-role")).toHaveValue(
      "consumer",
    );
  },
};

export const NewProtocol: Story = {
  play: async ({ canvasElement }) => {
    const modal = within(canvasElement);
    await userEvent.type(
      await modal.findByTestId("new-connection-protocol"),
      "mqtt",
    );
    await userEvent.click(
      await protocolOption(canvasElement, "Create protocol"),
    );
    await expect(
      modal.getByTestId("new-connection-protocol-hint"),
    ).toHaveTextContent("will be created");
    await expect(modal.getByTestId("new-connection-from-role")).toBeDisabled();
  },
};

export const RoleWithoutProtocol: Story = {
  play: async ({ canvasElement }) => {
    const modal = within(canvasElement);
    await userEvent.type(
      await modal.findByTestId("new-connection-from-role"),
      "master",
    );
    await expect(modal.getByTestId("new-connection-create")).toBeEnabled();
  },
};

// The drag began on a port dot, so that end keeps its port.
export const ExistingPortEnd: Story = {
  args: {
    request: {
      ...siblings,
      from: {
        ...siblings.from,
        portLabels: ["power-out"],
        existingPort: "power-out",
      },
    },
  },
};

// A component nested in another: the breadcrumb says which one, and the
// port is a boundary port because the connection leaves its parent.
export const NestedEndpoint: Story = {
  args: {
    request: {
      ...siblings,
      from: {
        key: "quadcopter/flight-controller/mcu",
        label: "mcu",
        component: "flight-controller/mcu",
        definition: "mcu",
        portLabels: [],
      },
      to: {
        key: "quadcopter/gps",
        label: "gps",
        component: "gps",
        definition: "gps",
        portLabels: [],
      },
    },
  },
  play: async ({ canvasElement }) => {
    const modal = within(canvasElement);
    await expect(
      await modal.findByTestId("new-connection-from-external"),
    ).toBeChecked();
    await expect(
      modal.getByTestId("new-connection-to-external"),
    ).not.toBeChecked();
  },
};

export const TakenName: Story = {
  play: async ({ canvasElement }) => {
    const modal = within(canvasElement);
    const name = await modal.findByTestId("new-connection-name");
    await userEvent.clear(name);
    await userEvent.type(name, "gps-link");
    await expect(modal.getByTestId("new-connection-problem")).toHaveTextContent(
      "already exists",
    );
    await expect(modal.getByTestId("new-connection-create")).toBeDisabled();
  },
};
