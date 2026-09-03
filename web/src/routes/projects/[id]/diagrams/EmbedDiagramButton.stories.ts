import type { Meta, StoryObj } from "@storybook/svelte";
import { userEvent, within } from "storybook/test";
import EmbedDiagramButton from "./EmbedDiagramButton.svelte";

const meta = {
  title: "Diagrams/EmbedDiagramButton",
  component: EmbedDiagramButton,
  parameters: {
    layout: "centered",
  },
  args: {
    projectId: "demo-project",
    diagramPath: "overview.hcl",
  },
} satisfies Meta<typeof EmbedDiagramButton>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Disabled: Story = {
  args: {
    disabled: true,
  },
};

export const NoDiagramSelected: Story = {
  args: {
    diagramPath: null,
  },
};

export const PinnedBaseUrl: Story = {
  args: {
    baseUrl: "https://rhizz.example.dev",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole("button", { name: /embed diagram/i });
    await userEvent.click(button);
    // Assert the Direct URL input's value matches the pinned origin plus the
    // embed route path. We use a pattern rather than an exact string because
    // SvelteKit's `resolve()` output can carry a base-path prefix between the
    // origin and the route (and on main no story asserts an exact resolved
    // URL). Anchoring on the deterministic origin — the thing under test,
    // not the Chromatic runner's `window.location.origin` — keeps the lookup
    // specific to the Direct URL <input>, since the iframe <textarea> value
    // starts with `<iframe` instead. `getByDisplayValue` throws if absent.
    canvas.getByDisplayValue(
      /^https:\/\/rhizz\.example\.dev\/.*\/projects\/demo-project\/diagrams\/embed\/overview\.hcl$/,
    );
  },
};
