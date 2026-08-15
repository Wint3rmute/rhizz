import type { Meta, StoryObj } from "@storybook/svelte";
import { expect, fn, userEvent, within } from "storybook/test";
import CreateComponentModal from "./CreateComponentModal.svelte";

const meta = {
  title: "Diagrams/CreateComponentModal",
  component: CreateComponentModal,
  args: {
    isOpen: true,
    availableParents: [
      {
        key: "quadcopter",
        label: "quadcopter",
        isSystem: true,
        path: "quadcopter",
      },
      {
        key: "quadcopter/flight-controller",
        label: "flight-controller",
        isSystem: false,
        path: "quadcopter/flight-controller",
      },
      {
        key: "ground-control",
        label: "ground-control",
        isSystem: true,
        path: "ground-control",
      },
    ],
    defaultParentKey: "quadcopter",
    oncreate: fn(),
    onclose: fn(),
  },
} satisfies Meta<typeof CreateComponentModal>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Open: Story = {
  args: {},
};

export const TextAlignSelection: Story = {
  args: {},
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);

    // Enter component name
    const nameInput = canvas.getByPlaceholderText(/flight-controller/i);
    await userEvent.type(nameInput, "sensor-unit");

    // Check text alignment buttons
    const centerBtn = canvas.getByRole("button", { name: "Center" });
    const topBtn = canvas.getByRole("button", { name: "Top" });
    const topLeftBtn = canvas.getByRole("button", { name: "Top-left" });

    // Initial state should be Center
    expect(centerBtn).toHaveClass("btn-primary");
    expect(topBtn).not.toHaveClass("btn-primary");
    expect(topLeftBtn).not.toHaveClass("btn-primary");

    // Click Top button
    await userEvent.click(topBtn);
    expect(topBtn).toHaveClass("btn-primary");
    expect(centerBtn).not.toHaveClass("btn-primary");
    expect(topLeftBtn).not.toHaveClass("btn-primary");

    // Click Top-left button
    await userEvent.click(topLeftBtn);

    // Assert Top-left is now active and others are inactive
    expect(topLeftBtn).toHaveClass("btn-primary");
    expect(topBtn).not.toHaveClass("btn-primary");
    expect(centerBtn).not.toHaveClass("btn-primary");

    // Submit modal
    const createBtn = canvas.getByRole("button", {
      name: "Create Component",
    });
    await userEvent.click(createBtn);

    // Verify oncreate was called with the selected textAlign: "top-left"
    expect(args.oncreate).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "sensor-unit",
        textAlign: "top-left",
      }),
    );
  },
};
