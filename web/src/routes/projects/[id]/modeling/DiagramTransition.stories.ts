import type { Meta, StoryObj } from "@storybook/svelte";
import { expect } from "storybook/test";
import { blendScenes } from "./blend";
import DiagramCanvasHost from "./DiagramCanvasHost.svelte";
import { buildReadOnlyScene } from "./scene";
import type { DiagramStaticBox, DiagramStaticComponent } from "./types";

// Screenshots of diagram transitions frozen mid-tween. The frame is produced
// by the real blend engine (blendScenes) from two resting scenes, so the
// baseline shows exactly what a viewer sees halfway through a view switch.
const meta = {
  title: "Diagrams/DiagramTransition",
  component: DiagramCanvasHost,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof DiagramCanvasHost>;

export default meta;

type Story = StoryObj<typeof meta>;

// Modelled on the drone example: the flight controller is a small centered
// block in one view and an open container with a top-center title in the
// other, and the GPS label moves from the middle to the top-left corner.
const components: DiagramStaticComponent[] = [
  { label: "flight-controller", icon: "microchip" },
  { label: "mcu", parent_component_index: 0 },
  { label: "imu", parent_component_index: 0 },
  { label: "gps" },
];
const ids = ["drone/fc", "drone/fc/mcu", "drone/fc/imu", "drone/gps"];

const overviewBoxes: Record<number, DiagramStaticBox> = {
  0: { x: 40, y: 120, width: 200, height: 100, textAlign: "center" },
  3: { x: 320, y: 120, width: 120, height: 80, textAlign: "center" },
};
const mainBoxes: Record<number, DiagramStaticBox> = {
  0: { x: 0, y: 0, width: 500, height: 360, textAlign: "top-center" },
  1: { x: 60, y: 180, width: 130, height: 90, textAlign: "center" },
  2: { x: 220, y: 180, width: 130, height: 90, textAlign: "center" },
  3: { x: 560, y: 0, width: 120, height: 80, textAlign: "top-left" },
};

function viewScene(boxes: Record<number, DiagramStaticBox>) {
  return buildReadOnlyScene({
    components,
    connections: [],
    boxes,
    ids,
    portsByIndex: {},
  });
}

export const LabelsHalfwayThroughViewSwitch: Story = {
  args: {
    scene: blendScenes(viewScene(overviewBoxes), viewScene(mainBoxes), 0.5),
    width: 1140,
    height: 660,
    viewBox: "-40 -40 760 440",
  },
  play: async ({ canvasElement }) => {
    const labels = new Map(
      Array.from(
        canvasElement.querySelectorAll("[data-testid=diagram-node]"),
      ).map((node) => [node.getAttribute("data-node-id"), node]),
    );
    // Both re-aligned labels are mid-slide: drawn in their target's
    // anchor/baseline, between the two resting placements.
    const fc = labels.get("drone/fc")?.querySelector("text");
    const gps = labels.get("drone/gps")?.querySelector("text");
    await expect(fc?.getAttribute("dominant-baseline")).toBe("hanging");
    await expect(Number(fc?.getAttribute("y"))).toBeGreaterThan(8);
    await expect(gps?.getAttribute("text-anchor")).toBe("start");
    await expect(Number(gps?.getAttribute("x"))).toBeGreaterThan(8);
    // The children arriving with the container are half faded in.
    await expect(labels.get("drone/fc/mcu")?.getAttribute("opacity")).toBe(
      "0.5",
    );
  },
};
