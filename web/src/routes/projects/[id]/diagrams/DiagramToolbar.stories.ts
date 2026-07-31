import type { Meta, StoryObj } from "@storybook/svelte";
import DiagramToolbar from "./DiagramToolbar.svelte";

const SNAP_GRID_SIZE_OPTIONS = [10, 20, 50, 100] as const;

// The toolbar is absolutely positioned (bottom-centre) — "fullscreen"
// gives it the whole preview iframe to anchor against, same as how
// Navbar.stories.ts uses it for a similarly viewport-anchored component.
const meta = {
  title: "Diagrams/DiagramToolbar",
  component: DiagramToolbar,
  parameters: {
    layout: "fullscreen",
  },
  args: {
    snapEnabled: false,
    snapActive: false,
    snapGridSize: SNAP_GRID_SIZE_OPTIONS[0],
    snapGridSizeOptions: SNAP_GRID_SIZE_OPTIONS,
    gridVisible: true,
    autoLayoutRunning: false,
    onautolayout: () => {},
    onzoomtofill: () => {},
    onresetview: () => {},
  },
} satisfies Meta<typeof DiagramToolbar>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {},
};

export const SnapActive: Story = {
  args: {
    snapEnabled: true,
    snapActive: true,
  },
};

export const AutoLayoutRunning: Story = {
  args: {
    autoLayoutRunning: true,
  },
};

// Constrains this story to a tablet-width viewport, unlike the other
// stories above (which render "fullscreen", giving the toolbar far more
// room than it actually has in the real app, where it's squeezed
// between two fixed-width sidebars). This is the story that would have
// caught the text-overflow/wrapping bug that only showed up once
// deployed, not in a full-width story.
export const NarrowCanvas: Story = {
  args: {},
  globals: {
    viewport: { value: "tablet" },
  },
  parameters: {
    layout: "centered",
  },
};
