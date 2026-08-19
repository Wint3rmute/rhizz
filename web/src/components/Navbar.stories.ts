import type { Meta, StoryObj } from "@storybook/svelte";
import type { ProjectJS } from "rhizz";
import {
  createProjectWithMainFile,
  projectStore,
} from "../ProjectState.svelte";
import Navbar from "./Navbar.svelte";

type StoryProject = Pick<ProjectJS, "name" | "version" | "authors">;

const sampleProject = {
  name: "BuzzVid",
  version: "1.0.0",
  authors: ["Ada Lovelace"],
} satisfies StoryProject;

await (async () => {
  const existing = await projectStore.listProjects();
  const match = existing.find((p) => p.name === "Navbar Story Project");
  if (match) return match;
  return await createProjectWithMainFile(
    "Navbar Story Project",
    `project { name = "Navbar Story Project" }`,
  );
})();

const meta = {
  title: "Components/Navbar",
  component: Navbar,
  parameters: {
    layout: "fullscreen",
  },
  args: {
    project: sampleProject as ProjectJS,
    errorCount: 2,
    warningCount: 1,
  },
} satisfies Meta<typeof Navbar>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Desktop: Story = {
  parameters: {
    viewport: { defaultViewport: "responsive" },
  },
};

export const MobileCollapsed: Story = {
  globals: {
    viewport: { value: "mobile1" },
  },
  parameters: {
    viewport: { defaultViewport: "mobile1" },
  },
  args: {
    isOpen: false,
  },
};

export const MobileExpanded: Story = {
  globals: {
    viewport: { value: "mobile1" },
  },
  parameters: {
    viewport: { defaultViewport: "mobile1" },
  },
  args: {
    isOpen: true,
  },
};
