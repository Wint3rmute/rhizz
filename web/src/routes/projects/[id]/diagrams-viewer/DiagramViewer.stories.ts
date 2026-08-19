import type { Meta, StoryObj } from "@storybook/svelte";
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
  writeDiagramLayoutFile,
} from "../diagrams/persistence";
import DiagramViewer from "./DiagramViewer.svelte";

const seededProject = await (async () => {
  const existing = await projectStore.listProjects();
  const match = existing.find((project) => project.name === "Viewer story");
  if (match) return match;
  const created = await createProjectWithMainFile(
    "Viewer story",
    EXAMPLE_SYSTEM_HCL,
  );
  const fs = openProjectFs(projectStore, created.id);
  for (const [name, layout] of Object.entries(EXAMPLE_SYSTEM_DIAGRAMS)) {
    await writeDiagramLayoutFile(fs, `${DIAGRAM_LAYOUT_DIR}/${name}`, layout);
  }
  return created;
})();

const manyDiagramsProject = await (async () => {
  const existing = await projectStore.listProjects();
  const match = existing.find(
    (project) => project.name === "Many diagrams story",
  );
  if (match) return match;
  const created = await createProjectWithMainFile(
    "Many diagrams story",
    EXAMPLE_SYSTEM_HCL,
  );
  const fs = openProjectFs(projectStore, created.id);
  const sampleLayout = EXAMPLE_SYSTEM_DIAGRAMS["overview.json"];
  const diagramNames = [
    "overview.json",
    "cloud-path.json",
    "sensor-network.json",
    "power-distribution.json",
    "data-pipeline.json",
  ];
  for (const name of diagramNames) {
    await writeDiagramLayoutFile(
      fs,
      `${DIAGRAM_LAYOUT_DIR}/${name}`,
      sampleLayout,
    );
  }
  return created;
})();

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
};

export const Mobile: Story = {
  globals: {
    viewport: { value: "mobile1" },
  },
  parameters: {
    viewport: { defaultViewport: "mobile1" },
  },
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
};
