import type { Meta, StoryObj } from "@storybook/svelte";
import { expect, within } from "storybook/test";
import BuildInfo from "./BuildInfo.svelte";

// The commit the running server was built from, rendered as a footer. The
// `buildInfo` prop is injected so the stories never touch the network.
const meta = {
  title: "Components/BuildInfo",
  component: BuildInfo,
  parameters: {
    layout: "centered",
  },
  args: {
    buildInfo: { git_sha: "07265fb" },
  },
} satisfies Meta<typeof BuildInfo>;

export default meta;

type Story = StoryObj<typeof meta>;

// A real revision links to its commit on GitHub.
export const Commit: Story = {
  args: { buildInfo: { git_sha: "07265fb" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const link = canvas.getByRole("link", { name: /rhizz build 07265fb/ });
    await expect(link).toHaveAttribute(
      "href",
      "https://github.com/Wint3rmute/rhizz/commit/07265fb",
    );
  },
};

// No server to ask (browser-only build): nothing renders. No baseline — the
// screenshot would be an empty page.
export const Hidden: Story = {
  tags: ["no-vrt"],
  args: { buildInfo: null },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByText(/rhizz build/)).toBeNull();
  },
};
