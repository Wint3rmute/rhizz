import type { Meta, StoryObj } from "@storybook/svelte";
import init from "rhizz";
import {
  createProjectWithMainFile,
  projectStore,
} from "../../../../ProjectState.svelte";
import {
  EXAMPLE_SYSTEM_DIAGRAMS,
  EXAMPLE_SYSTEM_HCL,
} from "../../../../example_system";
import { openProjectFs } from "../../../../vfs/fs";
import {
  DIAGRAM_LAYOUT_DIR,
  type DiagramLayout,
  writeDiagramLayoutFile,
} from "../diagrams/persistence";
import DiagramViewer from "./DiagramViewer.svelte";

// Initialize WASM module before evaluating story models
await init();

const sampleOverview = EXAMPLE_SYSTEM_DIAGRAMS["overview.hcl"];
const sampleCloud = EXAMPLE_SYSTEM_DIAGRAMS["cloud-path.hcl"];

const manyDiagramsMap: Record<string, DiagramLayout> = {
  "overview.hcl": sampleOverview,
  "cloud-path.hcl": sampleCloud,
  "sensor-network.hcl": sampleOverview,
  "power-distribution.hcl": sampleCloud,
  "data-pipeline.hcl": sampleOverview,
};

async function ensureProjectWithDiagrams(
  name: string,
  diagrams: Record<string, DiagramLayout>,
) {
  const existing = await projectStore.listProjects();
  let project = existing.find((p) => p.name === name);
  if (!project) {
    project = await createProjectWithMainFile(name, EXAMPLE_SYSTEM_HCL);
  }
  const fs = openProjectFs(projectStore, project.id);
  for (const [dName, layout] of Object.entries(diagrams)) {
    await writeDiagramLayoutFile(fs, `${DIAGRAM_LAYOUT_DIR}/${dName}`, layout);
  }
  return project;
}

const seededProject = await ensureProjectWithDiagrams(
  "Viewer story",
  EXAMPLE_SYSTEM_DIAGRAMS,
);

const manyDiagramsProject = await ensureProjectWithDiagrams(
  "Many diagrams story",
  manyDiagramsMap,
);

const meta = {
  title: "Pages/DiagramViewer",
  component: DiagramViewer,
  parameters: {
    layout: "fullscreen",
  },
  args: {
    projectId: seededProject.id,
  },
} satisfies Meta<typeof DiagramViewer>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Desktop: Story = {
  parameters: {
    viewport: { defaultViewport: "responsive" },
  },
  loaders: [
    async () => {
      await init();
      const fs = openProjectFs(projectStore, seededProject.id);
      for (const [name, layout] of Object.entries(EXAMPLE_SYSTEM_DIAGRAMS)) {
        await writeDiagramLayoutFile(
          fs,
          `${DIAGRAM_LAYOUT_DIR}/${name}`,
          layout,
        );
      }
      return {};
    },
  ],
};

export const Mobile: Story = {
  globals: {
    viewport: { value: "mobile1" },
  },
  parameters: {
    viewport: { defaultViewport: "mobile1" },
  },
  loaders: [
    async () => {
      await init();
      const fs = openProjectFs(projectStore, seededProject.id);
      for (const [name, layout] of Object.entries(EXAMPLE_SYSTEM_DIAGRAMS)) {
        await writeDiagramLayoutFile(
          fs,
          `${DIAGRAM_LAYOUT_DIR}/${name}`,
          layout,
        );
      }
      return {};
    },
  ],
};

export const MobileManyDiagrams: Story = {
  globals: {
    viewport: { value: "mobile1" },
  },
  parameters: {
    viewport: { defaultViewport: "mobile1" },
  },
  args: {
    projectId: manyDiagramsProject.id,
  },
  loaders: [
    async () => {
      await init();
      const fs = openProjectFs(projectStore, manyDiagramsProject.id);
      for (const [name, layout] of Object.entries(manyDiagramsMap)) {
        await writeDiagramLayoutFile(
          fs,
          `${DIAGRAM_LAYOUT_DIR}/${name}`,
          layout,
        );
      }
      return {};
    },
  ],
};
