import type { Meta, StoryObj } from "@storybook/svelte";
import CompletionBreakdown from "./CompletionBreakdown.svelte";

const meta = {
  title: "Components/CompletionBreakdown",
  component: CompletionBreakdown,
  args: {
    overallPct: 72,
    completeTotal: 8,
    grandTotal: 12,
    components: { complete: 5, partial: 2, incomplete: 1, pct: 58 },
    ports: { complete: 3, partial: 1, incomplete: 2, pct: 50 },
    connections: { complete: 2, partial: 1, incomplete: 1, pct: 60 },
    messages: { complete: 4, partial: 0, incomplete: 1, pct: 80 },
  },
} satisfies Meta<typeof CompletionBreakdown>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
