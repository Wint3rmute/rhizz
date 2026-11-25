import type { Meta, StoryObj } from "@storybook/svelte";
import { expect, userEvent, within } from "storybook/test";
import init from "rhizz";
import type { Project } from "../../../../vfs/types";
import { projectSlug } from "../../../../vfs/slug";
import {
  createProjectWithMainFile,
  projectStore,
} from "../../../../ProjectState.svelte";
import {
  CROSS_LEVEL_SYSTEM_DIAGRAMS,
  CROSS_LEVEL_SYSTEM_HCL,
} from "../../../../testing/cross_level_fixture";
import { openProjectFs } from "../../../../vfs/fs";
import {
  type DiagramLayout,
  VIEW_LAYOUT_DIR,
  writeDiagramLayoutFile,
} from "../modeling/persistence";
import Explore from "./Explore.svelte";

// Deterministic project ids so story args can be built synchronously at
// module scope while async seeding runs from loaders (top-level await in
// story files races the vitest-addon's test registration).
const SEEDED_PROJECT_NAME = "Viewer story";
const MANY_DIAGRAMS_PROJECT_NAME = "Many diagrams story";
const CROSS_LEVEL_PROJECT_NAME = "Cross level connections story";
// A project's id is the slug of its name (see vfs/slug), so a story derives
// its fixture ids the same way the app does — synchronously, because the meta
// args below need them at module scope.
const SEEDED_PROJECT_ID = projectSlug(SEEDED_PROJECT_NAME);
const MANY_DIAGRAMS_PROJECT_ID = projectSlug(MANY_DIAGRAMS_PROJECT_NAME);
const CROSS_LEVEL_PROJECT_ID = projectSlug(CROSS_LEVEL_PROJECT_NAME);

const sampleOverview = CROSS_LEVEL_SYSTEM_DIAGRAMS["overview.hcl"];
const sampleController = CROSS_LEVEL_SYSTEM_DIAGRAMS["controller.hcl"];

const EMPTY_LAYOUT: DiagramLayout = {
  checked: {},
  connections: {},
};

const seededDiagramsMap: Record<string, DiagramLayout> = {
  "overview.hcl": sampleOverview ?? EMPTY_LAYOUT,
  "controller.hcl": sampleController ?? EMPTY_LAYOUT,
};

const manyDiagramsMap: Record<string, DiagramLayout> = {
  "overview.hcl": sampleOverview ?? EMPTY_LAYOUT,
  "controller.hcl": sampleController ?? EMPTY_LAYOUT,
  "sensor-network.hcl": sampleOverview ?? EMPTY_LAYOUT,
  "power-distribution.hcl": sampleController ?? EMPTY_LAYOUT,
  "data-pipeline.hcl": sampleOverview ?? EMPTY_LAYOUT,
};

async function ensureProjectWithDiagrams(
  name: string,
  diagrams: Record<string, DiagramLayout>,
  hclContent: string = CROSS_LEVEL_SYSTEM_HCL,
): Promise<Project> {
  await init();
  // The id follows from the name (vfs/slug) — the store derives it, so this
  // only has to look the project up by the same rule to stay idempotent.
  const id = projectSlug(name);
  const existing = await projectStore.listProjects();
  const project =
    existing.find((p) => p.id === id) ??
    (await createProjectWithMainFile(name, hclContent));
  const fs = openProjectFs(projectStore, project.id);
  for (const [dName, layout] of Object.entries(diagrams)) {
    await writeDiagramLayoutFile(fs, `${VIEW_LAYOUT_DIR}/${dName}`, layout);
  }
  return project;
}

async function ensureSeededProject(): Promise<Project> {
  return ensureProjectWithDiagrams(SEEDED_PROJECT_NAME, seededDiagramsMap);
}

async function ensureManyDiagramsProject(): Promise<Project> {
  return ensureProjectWithDiagrams(MANY_DIAGRAMS_PROJECT_NAME, manyDiagramsMap);
}

async function ensureCrossLevelProject(): Promise<Project> {
  const project = await ensureProjectWithDiagrams(
    CROSS_LEVEL_PROJECT_NAME,
    CROSS_LEVEL_SYSTEM_DIAGRAMS,
    CROSS_LEVEL_SYSTEM_HCL,
  );
  // Seeded doc for battery (whose full_name is "Main power source").
  const fs = openProjectFs(projectStore, project.id);
  await fs.mkdir("docs", { recursive: true });
  await fs.writeFile("docs/battery.md", "Stores charge.\n");
  await fs.writeFile("docs/mcu.md", "STM Microcontroller.\n");
  return project;
}

const meta = {
  title: "Pages/Explore",
  component: Explore,
  parameters: {
    layout: "fullscreen",
  },
  args: {
    projectId: SEEDED_PROJECT_ID,
  },
} satisfies Meta<typeof Explore>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Desktop: Story = {
  parameters: {
    viewport: { defaultViewport: "responsive" },
  },
  loaders: [ensureSeededProject],
};

export const MobileManyDiagrams: Story = {
  tags: ["no-vrt"],
  globals: {
    viewport: { value: "mobile1" },
  },
  parameters: {
    viewport: { defaultViewport: "mobile1" },
  },
  args: {
    projectId: MANY_DIAGRAMS_PROJECT_ID,
  },
  loaders: [ensureManyDiagramsProject],
};

// Same five diagrams on desktop: the tree is long enough to scroll, so this
// story covers the embed button staying pinned to the sidebar's bottom edge
// instead of scrolling away with the list.
export const ManyDiagramsDesktop: Story = {
  tags: ["no-vrt"],
  parameters: {
    viewport: { defaultViewport: "responsive" },
  },
  args: {
    projectId: MANY_DIAGRAMS_PROJECT_ID,
  },
  loaders: [ensureManyDiagramsProject],
};

export const CrossLevelConnections: Story = {
  tags: ["no-vrt"],
  parameters: {
    viewport: { defaultViewport: "responsive" },
  },
  args: {
    projectId: CROSS_LEVEL_PROJECT_ID,
  },
  loaders: [ensureCrossLevelProject],
};

export const HoverDocHeader: Story = {
  parameters: {
    viewport: { defaultViewport: "responsive" },
  },
  args: {
    projectId: CROSS_LEVEL_PROJECT_ID,
  },
  loaders: [ensureCrossLevelProject],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Hovering the battery node shows its doc tooltip headed by the
    // component's full_name as an L1 header (read-only — no save here).
    // Hover the node's <a> anchor: the SVG label itself is
    // pointer-events-none, so userEvent refuses to target it directly.
    const anchor = canvas.getByText("battery").closest("a");
    if (!anchor) throw new Error("battery node has no hover anchor");
    // Explicit *client* coordinates at the node's centre, measured here
    // rather than passed as an offset: the popup anchors itself to the
    // cursor, and a relative `coords: {x, y}` does not become clientX/Y —
    // it left the event at (0, 0), parking the popup at a negative offset
    // clipped to the container's corner, i.e. positioned by an accident of
    // layout that a scroll (or another machine's layout) moves.
    const node = anchor.getBoundingClientRect();
    if (node.width === 0) throw new Error("battery node has no box");
    await userEvent.pointer({
      target: anchor,
      coords: {
        clientX: node.left + node.width / 2,
        clientY: node.top + node.height / 2,
      },
    });

    const tooltip = await canvas.findByTestId("explore-doc-tooltip");
    const tooltipQueries = within(tooltip);
    await expect(
      tooltipQueries.getByRole("heading", {
        name: "Main power source",
      }),
    ).toBeTruthy();
    await expect(tooltipQueries.getByText("Stores charge.")).toBeTruthy();
  },
};

// Runs at the vitest browser's phone-sized viewport (Storybook's viewport
// params only size the manager UI), which is what makes this the mobile
// counterpart of the desktop e2e run: no second navbar, the open diagram
// marked in the chip row, and no embed action to waste strip height on.
export const MobileNoEmbed: Story = {
  globals: {
    viewport: { value: "mobile1" },
  },
  parameters: {
    viewport: { defaultViewport: "mobile1" },
  },
  args: {
    projectId: CROSS_LEVEL_PROJECT_ID,
  },
  loaders: [ensureCrossLevelProject],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryAllByRole("navigation")).toHaveLength(0);
    const sidebar = canvas.getByRole("complementary", { name: "Diagrams" });
    const sidebarQueries = within(sidebar);
    // The open diagram is marked inside the sidebar (aria-current) — that
    // is what the breadcrumb used to spell out above the canvas. Marked in
    // whichever selector is on screen: chips (< md) or file tree.
    const openDiagram = await sidebarQueries.findByRole("button", {
      current: true,
    });
    await expect(openDiagram.textContent).toContain(".hcl");
    await expect(
      sidebarQueries.queryByRole("button", { name: /embed diagram/i }),
    ).toBeNull();
  },
};
