import type { Meta, StoryObj } from "@storybook/svelte";
import IconAutocompleteInput from "./IconAutocompleteInput.svelte";

const meta = {
  title: "Components/IconAutocompleteInput",
  component: IconAutocompleteInput,
  args: {
    value: "microchip",
    label: "Component Icon",
    placeholder: "e.g. microchip, server, database",
  },
} satisfies Meta<typeof IconAutocompleteInput>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    value: "microchip",
  },
};

export const Empty: Story = {
  args: {
    value: "",
  },
};

export const ServerIcon: Story = {
  args: {
    value: "server",
  },
};

export const WifiIcon: Story = {
  args: {
    value: "wifi",
  },
};
