import type { Meta, StoryObj } from "@storybook/svelte";
import { expect, within } from "storybook/test";
import type {
  ConnectionData,
  PortData,
  ProtocolData,
} from "../../../../modelView";
import ConnectionInspector from "./ConnectionInspector.svelte";

const httpRequest: ConnectionData = {
  ref: { scopePath: "banking", label: "http-request" },
  full_name: "HTTP request",
  tags: [],
  level: 0,
  from_port: "web",
  to_port: "web",
  protocol: "https",
  realized_by: [],
  complete: true,
};

const fundTransfer: ConnectionData = {
  ref: { scopePath: "banking", label: "fund-transfer" },
  full_name: "Fund transfer",
  tags: ["payments"],
  level: 1,
  from_port: "pay",
  to_port: "pay",
  protocol: "payment",
  realized_by: [{ scopePath: "banking", label: "http-request" }],
  complete: true,
};

const payment: ProtocolData = {
  label: "payment",
  full_name: "Payment message",
  tags: [],
  roles: [],
  leaf: false,
  encapsulates: [],
  messages: [],
};

const paymentPort: PortData = {
  label: "pay",
  protocol: "payment",
  role: "peer",
};

const webPort: PortData = {
  label: "web",
  protocol: "https",
  role: "peer",
};

const sparePort: PortData = {
  label: "spare",
  protocol: "payment",
  role: "peer",
};

const endpointPorts = [paymentPort, webPort, sparePort];

const noop = () => {};

const meta = {
  title: "Diagrams/ConnectionInspector",
  component: ConnectionInspector,
  args: {
    projectId: "bank-demo",
    connection: fundTransfer,
    fromLabel: "bank-a",
    toLabel: "bank-b",
    fromPorts: endpointPorts,
    toPorts: endpointPorts,
    fromConnectedPorts: new Set(["pay"]),
    toConnectedPorts: new Set(["pay"]),
    sharedWithCopies: false,
    protocol: payment,
    protocolReason: undefined,
    protocolUsage: { connections: 1, ports: 2 },
    connections: [fundTransfer, httpRequest],
    placedLabels: ["fund-transfer", "http-request"],
    startSide: undefined,
    endSide: undefined,
    onupdate: noop,
    onselect: noop,
    onsetstartside: noop,
    onsetendside: noop,
    ondelete: noop,
  },
  globals: {
    viewport: { value: "phone" },
  },
} satisfies Meta<typeof ConnectionInspector>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A connection with no realization yet: the candidate select is offered. */
export const Default: Story = {
  args: {
    connection: { ...fundTransfer, realized_by: [] },
  },
};

/** A complete chain: `fund-transfer` is realized by `http-request`, which is itself complete. */
export const Realized: Story = {
  args: {
    connection: fundTransfer,
    protocol: payment,
    connections: [fundTransfer, httpRequest],
  },
};

/** The realizing connection is missing its own realization: the inspector names the blocker. */
export const Incomplete: Story = {
  args: {
    connection: {
      ...fundTransfer,
      complete: false,
      blocking: { scopePath: "banking", label: "http-request" },
      realized_by: [{ scopePath: "banking", label: "http-request" }],
    },
  },
};

/** The endpoints share no defined protocol, so the panel says why instead of showing empty fields. */
export const UndefinedProtocol: Story = {
  args: {
    connection: { ...httpRequest, protocol: undefined },
    protocol: undefined,
    protocolReason: "The ports use different protocols (https and i2c).",
    protocolUsage: undefined,
  },
};

/**
 * Every port on both endpoint components is listed with a connected badge.
 * `pay` is an endpoint of this connection; `web` and `spare` are not, so they
 * show as not connected. Status is explicitly per placed instance.
 */
export const PortConnectionStatus: Story = {
  args: {
    connection: fundTransfer,
    fromPorts: endpointPorts,
    toPorts: endpointPorts,
    fromConnectedPorts: new Set(["pay"]),
    toConnectedPorts: new Set(["pay"]),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const from = await canvas.findByTestId("from-ports");
    const to = await canvas.findByTestId("to-ports");

    await expect(within(from).getAllByText("Connected")).toHaveLength(1);
    await expect(within(from).getAllByText("Not connected")).toHaveLength(2);
    await expect(within(to).getAllByText("Connected")).toHaveLength(1);
    await expect(within(to).getAllByText("Not connected")).toHaveLength(2);
    await expect(canvas.getByText(/per placed instance/i)).toBeTruthy();
  },
};

/**
 * The split itself: protocol and connection attributes in their own panels,
 * the view panel holding only the side pickers, and each heading naming the
 * file it writes to, on hover.
 */
export const AttributeScopes: Story = {
  args: {
    connection: { ...fundTransfer, realized_by: [] },
    sharedWithCopies: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const protocol = await canvas.findByTestId("protocol-attributes");
    const connection = await canvas.findByTestId("connection-attributes");
    const view = await canvas.findByTestId("view-attributes");

    // The protocol panel is read-only: nothing editable inside it.
    await expect(within(protocol).queryByRole("textbox")).toBeNull();
    await expect(within(protocol).queryByRole("spinbutton")).toBeNull();
    await expect(within(protocol).getByText("Payment message")).toBeTruthy();
    // "Edit protocol" opens the protocol in the Inventory, not in this panel.
    await expect(
      within(protocol).getByTestId("edit-protocol-link"),
    ).toHaveAttribute(
      "href",
      expect.stringContaining("/inventory?tab=protocols&protocol=payment"),
    );

    // The connection panel holds the editable fields and the realization.
    await expect(
      within(connection).getByLabelText(/^full name$/i),
    ).toBeTruthy();
    await expect(within(connection).getByLabelText(/^level$/i)).toBeTruthy();
    await expect(within(connection).queryByText("Text alignment")).toBeNull();

    // The view panel holds the side pickers, and nothing else.
    await expect(within(view).getByText(/bank-a starting point/)).toBeTruthy();
    await expect(within(view).queryByLabelText(/^full name$/i)).toBeNull();

    await expect(
      within(protocol).getByTestId("protocol-attributes-heading"),
    ).toHaveAttribute("data-tip", expect.stringContaining("system.hcl"));
    await expect(
      within(connection).getByTestId("connection-attributes-heading"),
    ).toHaveAttribute("data-tip", expect.stringContaining("system.hcl"));
    await expect(
      within(connection).getByTestId("connection-attributes-heading"),
    ).toHaveAttribute("data-tip", expect.stringContaining("copies"));
    await expect(
      within(view).getByTestId("view-attributes-heading"),
    ).toHaveAttribute("data-tip", expect.stringContaining("views/"));
  },
};
