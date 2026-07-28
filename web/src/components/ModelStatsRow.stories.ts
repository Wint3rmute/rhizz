import type { Meta, StoryObj } from "@storybook/svelte";
import ModelStatsRow from "./ModelStatsRow.svelte";

const meta = {
  title: "Components/ModelStatsRow",
  component: ModelStatsRow,
  args: {
    componentCount: 8,
    leafCount: 6,
    compositeCount: 2,
    portCount: 12,
    portsPct: 80,
    connectionCount: 10,
    connectionsPct: 60,
    overallPct: 82,
    messageCount: 5,
  },
} satisfies Meta<typeof ModelStatsRow>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    componentCount: 8,
    leafCount: 6,
    compositeCount: 2,
    portCount: 12,
    portsPct: 80,
    connectionCount: 10,
    connectionsPct: 60,
    overallPct: 82,
    messageCount: 5,
  },
};
