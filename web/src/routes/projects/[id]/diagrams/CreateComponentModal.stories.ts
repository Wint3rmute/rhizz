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
    reusableDefinitions: [
      {
        sourceLabel: "flight-controller",
        label: "flight-controller",
        icon: "microchip",
      },
      {
        sourceLabel: "gps-module",
        label: "gps-module",
        icon: "location-crosshairs",
      },
    ],
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
    await expect(centerBtn).toHaveClass("btn-primary");
    await expect(topBtn).not.toHaveClass("btn-primary");
    await expect(topLeftBtn).not.toHaveClass("btn-primary");

    // Click Top button
    await userEvent.click(topBtn);
    await expect(topBtn).toHaveClass("btn-primary");
    await expect(centerBtn).not.toHaveClass("btn-primary");
    await expect(topLeftBtn).not.toHaveClass("btn-primary");

    // Click Top-left button
    await userEvent.click(topLeftBtn);

    // Assert Top-left is now active and others are inactive
    await expect(topLeftBtn).toHaveClass("btn-primary");
    await expect(topBtn).not.toHaveClass("btn-primary");
    await expect(centerBtn).not.toHaveClass("btn-primary");

    // Submit modal
    const createBtn = canvas.getByRole("button", {
      name: "Create Component",
    });
    await userEvent.click(createBtn);

    // Verify oncreate was called with the selected textAlign: "top-left"
    await expect(args.oncreate).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "sensor-unit",
        textAlign: "top-left",
      }),
    );
  },
};

export const UseExistingComponent: Story = {
  args: {},
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);

    // Switch to "Use Existing Component" mode.
    const reuseBtn = canvas.getByRole("button", {
      name: "Use Existing Component",
    });
    await userEvent.click(reuseBtn);

    // Open the definition dropdown (its label is "Reusable Definition") and
    // pick the second definition.
    await userEvent.click(
      canvas.getByRole("button", { name: "Reusable Definition *" }),
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "gps-module" }),
    );

    // Enter the instance label.
    const nameInput = canvas.getByPlaceholderText(/flight-controller/i);
    await userEvent.type(nameInput, "gps");

    // Submit.
    await userEvent.click(
      canvas.getByRole("button", { name: "Create Component" }),
    );

    await expect(args.oncreate).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "gps",
        sourceLabel: "gps-module",
      }),
    );
  },
};

export const NoReusableDefinitions: Story = {
  args: {
    reusableDefinitions: [],
  },
};
