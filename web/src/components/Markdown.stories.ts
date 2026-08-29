import type { Meta, StoryObj } from "@storybook/svelte";
import Markdown from "./Markdown.svelte";

const SAMPLE_DOC = `# MCU

The **microcontroller** runs the control loop.

## Responsibilities

- Read sensor data over I2C
- Publish to the broker via MQTT

## Wiring

Use \`i2c\` on the [sensor](https://example.com/sensor).

\`\`\`
const sample = "code";
\`\`\`
`;

const meta = {
  title: "Components/Markdown",
  component: Markdown,
  parameters: {
    layout: "padded",
  },
  args: {
    content: SAMPLE_DOC,
  },
} satisfies Meta<typeof Markdown>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Empty: Story = {
  args: {
    content: "",
  },
};
