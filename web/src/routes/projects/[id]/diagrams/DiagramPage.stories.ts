import type { Meta, StoryObj } from "@storybook/svelte";
import { expect, within } from "storybook/test";
import init from "rhizz";
import type { Project } from "../../../../vfs/types";
import {
  createProjectWithMainFile,
  projectStore,
} from "../../../../ProjectState.svelte";
import DiagramPage from "./+page.svelte";

await init();

const INVALID_SYSTEM_HCL = `project {
  name = "broken-project"
}

project {
  name = "duplicate-project-block"
}

system "demo" {
  component "frontend" {
    leaf = true
  }
}
`;

async function ensureBrokenProject(): Promise<Project> {
  const existing = await projectStore.listProjects();
  const project = existing.find((candidate) =>
    candidate.name === "Broken diagram story"
  );
  return project ?? await createProjectWithMainFile(
    "Broken diagram story",
    INVALID_SYSTEM_HCL,
  );
}

const brokenProject: Project = await ensureBrokenProject();

const meta = {
  title: "Pages/Diagrams/Compilation Error",
  component: DiagramPage,
  parameters: {
    layout: "fullscreen",
  },
  args: {
    data: {
      projectId: brokenProject.id,
    },
  },
} satisfies Meta<typeof DiagramPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DuplicateProjectBlock: Story = {
  args: {
    params: {
      id: brokenProject.id,
    },
    data: {
      projectId: brokenProject.id,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(
      await canvas.findByRole("heading", { name: "Model failed to compile" }),
    ).toBeInTheDocument();
    await expect(canvas.getByText(/1 error detected in the system model/))
      .toBeInTheDocument();
    await expect(canvas.getByText("[E000]"))
      .toBeInTheDocument();

    const editorLink = canvas.getByRole("link", { name: "Open Editor to Fix" });
    await expect(editorLink).toHaveAttribute(
      "href",
      expect.stringContaining(`/projects/${brokenProject.id}/editor`),
    );
  },
};
