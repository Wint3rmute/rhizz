import type { Meta, StoryObj } from "@storybook/svelte";
import type { ProjectJS } from "rhizz";
import Navbar from "./Navbar.svelte";

type StoryProject = Pick<ProjectJS, "name" | "version" | "authors">;

const sampleProject = {
  name: "BuzzVid",
  version: "1.0.0",
  authors: ["Ada Lovelace"],
} satisfies StoryProject;

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

export const Default: Story = {};
