import type { Meta, StoryObj } from "@storybook/svelte";
import { expect, fn, userEvent, within } from "storybook/test";
import NewViewModal from "./NewViewModal.svelte";

const meta = {
  title: "Diagrams/NewViewModal",
  component: NewViewModal,
  args: {
    isOpen: true,
    systems: [{ label: "quadcopter" }, { label: "ground-control" }],
    defaultSystem: "quadcopter",
    oncreate: fn(),
    onclose: fn(),
  },
} satisfies Meta<typeof NewViewModal>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Open: Story = {
  args: {},
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("new-view-modal")).toBeInTheDocument();
    await expect(canvas.getByLabelText(/View Name/)).toBeInTheDocument();
    await expect(canvas.getByLabelText(/System/)).toBeInTheDocument();
    // Default system pre-selected.
    await expect(canvas.getByLabelText(/System/)).toHaveValue("quadcopter");
    // Empty name → Create disabled.
    await expect(canvas.getByRole("button", { name: "Create View" }))
      .toBeDisabled();
  },
};

export const Submit: Story = {
  args: {},
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText(/View Name/), "overview.hcl");
    // Switch system via the select.
    await userEvent.selectOptions(
      canvas.getByLabelText(/System/),
      "ground-control",
    );
    await userEvent.click(canvas.getByRole("button", { name: "Create View" }));
    await expect(args.oncreate).toHaveBeenCalledWith({
      name: "overview.hcl",
      system: "ground-control",
    });
  },
};

export const AppendsExtension: Story = {
  args: {},
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText(/View Name/), "power-paths");
    await userEvent.click(canvas.getByRole("button", { name: "Create View" }));
    await expect(args.oncreate).toHaveBeenCalledWith({
      name: "power-paths.hcl",
      system: "quadcopter",
    });
  },
};

export const NoSystems: Story = {
  args: { systems: [], defaultSystem: undefined },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/No systems yet/)).toBeInTheDocument();
  },
};
