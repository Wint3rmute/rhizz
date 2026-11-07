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

// A tagged build names the release and links to the tag rather than the commit.
export const Tagged: Story = {
  args: { buildInfo: { git_sha: "a37bd15", git_tag: "0.10.0" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const link = canvas.getByRole("link", {
      name: /rhizz build 0\.10\.0 \(a37bd15\)/,
    });
    await expect(link).toHaveAttribute(
      "href",
      "https://github.com/Wint3rmute/rhizz/releases/tag/0.10.0",
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
