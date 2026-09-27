import type { Meta, StoryObj } from "@storybook/svelte";
import { expect, within } from "storybook/test";
import init from "rhizz";
import { projectSlug } from "../../../../vfs/slug";
import {
  createProjectWithMainFile,
  projectStore,
} from "../../../../ProjectState.svelte";
import {
  EXAMPLE_SYSTEM_DIAGRAMS,
  EXAMPLE_SYSTEM_HCL,
} from "../../../../example_system";
import { openProjectFs } from "../../../../vfs/fs";
import DiagramViewer from "./DiagramViewer.svelte";
import { VIEW_LAYOUT_DIR, writeDiagramLayoutFile } from "./persistence";

// The viewer is the shared session behind Explore and embed. This story only
// checks that a seeded layout actually paints; hover and drill-down stay
// covered by the Explore and embed suites. A screenshot cannot show the load,
// so it opts out of VRT.
const PROJECT_NAME = "Diagram viewer story";
const PROJECT_ID = projectSlug(PROJECT_NAME);

const meta = {
  title: "Diagrams/DiagramViewer",
  component: DiagramViewer,
  tags: ["no-vrt"],
  args: {
    projectId: PROJECT_ID,
    diagramPath: "overview.hcl",
    onOpenDiagram: () => {},
  },
} satisfies Meta<typeof DiagramViewer>;

export default meta;

type Story = StoryObj<typeof meta>;

export const SeededOverview: Story = {
  loaders: [
    async () => {
      await init();
      const existing = await projectStore.listProjects();
      const project = existing.find((item) => item.id === PROJECT_ID) ??
        await createProjectWithMainFile(PROJECT_NAME, EXAMPLE_SYSTEM_HCL);
      const fs = openProjectFs(projectStore, project.id);
      const layout = EXAMPLE_SYSTEM_DIAGRAMS["overview.hcl"];
      if (!layout) throw new Error("example overview layout missing");
      await writeDiagramLayoutFile(
        fs,
        `${VIEW_LAYOUT_DIR}/overview.hcl`,
        layout,
      );
      return {};
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("sensor")).toBeTruthy();
    await expect(canvas.getByText("broker")).toBeTruthy();
  },
};
