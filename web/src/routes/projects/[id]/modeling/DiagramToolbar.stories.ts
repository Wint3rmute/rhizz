import type { Meta, StoryObj } from "@storybook/svelte";
import DiagramToolbar from "./DiagramToolbar.svelte";

const SNAP_GRID_SIZE_OPTIONS = [10, 20, 50, 100] as const;

// The toolbar is absolutely positioned (top-centre) — "fullscreen"
// gives it the whole preview iframe to anchor against, same as how
// Navbar.stories.ts uses it for a similarly viewport-anchored component.
const meta = {
  title: "Diagrams/DiagramToolbar",
  component: DiagramToolbar,
  parameters: {
    layout: "fullscreen",
  },
  args: {
    gridVisible: true,
    onzoomtofill: () => {},
  },
} satisfies Meta<typeof DiagramToolbar>;

export default meta;

type Story = StoryObj<typeof meta>;

const fullArgs = {
  snapEnabled: false,
  snapActive: false,
  snapGridSize: SNAP_GRID_SIZE_OPTIONS[0],
  snapGridSizeOptions: SNAP_GRID_SIZE_OPTIONS,
  gridVisible: true,
  autoLayoutRunning: false,
  onautolayout: () => {},
  onzoomtofill: () => {},
  onresetview: () => {},
  onaddcomponent: () => {},
  onaddannotation: () => {},
};

export const Default: Story = {
  args: fullArgs,
};

export const SnapActive: Story = {
  args: {
    ...fullArgs,
    snapEnabled: true,
    snapActive: true,
  },
};

export const AutoLayoutRunning: Story = {
  args: {
    ...fullArgs,
    autoLayoutRunning: true,
  },
};

// The minimal toolbar re-used on explore/ and inventory/: only "Toggle Grid"
// and "Zoom to Fill". Omitting the snap/auto-layout/reset/add callbacks
// hides those buttons — this story locks that subset in (VRT).
export const Minimal: Story = {
  args: {},
};

// Constrains this story to a tablet-width viewport, unlike the other
// stories above (which render "fullscreen", giving the toolbar far more
// room than it actually has in the real app, where it's squeezed
// between two fixed-width sidebars). This is the story that would have
// caught the text-overflow/wrapping bug that only showed up once
// deployed, not in a full-width story.
export const NarrowCanvas: Story = {
  args: fullArgs,
  globals: {
    viewport: { value: "tablet" },
  },
  parameters: {
    layout: "centered",
  },
};
