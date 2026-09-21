import type { Meta, StoryObj } from "@storybook/svelte";
import { fn } from "storybook/test";
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

export const NoReusableDefinitions: Story = {
  args: {
    reusableDefinitions: [],
  },
};
