import type { Meta, StoryObj } from "@storybook/svelte";
import { expect, within } from "storybook/test";
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
  // Regression check for the actual bug this story exists to catch: the
  // toolbar's background/border box (the `data-testid="diagram-toolbar"`
  // div) must fully contain every button, not just look fine at full
  // width. Bounding-box containment, rather than a screenshot diff, is
  // what caught the "w-max" fix actually working — a `left-1/2
  // -translate-x-1/2` box with no explicit width silently clips to half
  // the container's width on a narrow viewport (see git history for the
  // full CSS explanation), which this assertion fails loudly on.
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const toolbar = canvas.getByTestId("diagram-toolbar");
    const toolbarRect = toolbar.getBoundingClientRect();

    for (const button of canvas.getAllByRole("button")) {
      const buttonRect = button.getBoundingClientRect();
      expect(buttonRect.left).toBeGreaterThanOrEqual(toolbarRect.left - 1);
      expect(buttonRect.right).toBeLessThanOrEqual(toolbarRect.right + 1);
    }
  },
};
