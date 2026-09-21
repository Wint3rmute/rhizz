import type { Meta, StoryObj } from "@storybook/svelte";
import { fn } from "storybook/test";
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
};

export const NoSystems: Story = {
  args: { systems: [], defaultSystem: undefined },
};
