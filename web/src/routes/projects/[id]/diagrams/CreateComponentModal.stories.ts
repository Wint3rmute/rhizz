import type { Meta, StoryObj } from "@storybook/svelte";
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
    oncreate: () => {},
    onclose: () => {},
  },
} satisfies Meta<typeof CreateComponentModal>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Open: Story = {
  args: {},
};
