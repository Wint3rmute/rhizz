import type { Meta, StoryObj } from "@storybook/svelte";
import {
  createProjectWithMainFile,
  projectStore,
} from "../../ProjectState.svelte";
import {
  EXAMPLE_SYSTEM_DIAGRAMS,
  EXAMPLE_SYSTEM_HCL,
} from "../../example_system";
import { openProjectFs } from "../../vfs/fs";
import {
  DIAGRAM_LAYOUT_DIR,
  writeDiagramLayoutFile,
} from "../projects/[id]/diagrams/persistence";
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

export const Default: Story = {};
