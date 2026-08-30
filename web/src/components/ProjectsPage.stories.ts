import type { Meta, StoryObj } from "@storybook/svelte";
import { expect, userEvent, within } from "storybook/test";
import init from "rhizz";
import { get_example_projects } from "../rhizz_wasm_wrapper";
import type { Project } from "../vfs/types";
import ProjectsPage from "./ProjectsPage.svelte";

// The examples modal needs the compiled WASM (bundled example projects),
// so initialize it up front like the other page-level stories do.
await init();

const sampleProject = (
  id: string,
  name: string,
  updatedAt: string,
): Project => ({
  id,
  name,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt,
});

const projects = [
  sampleProject("p1", "Drone telemetry", "2026-03-10T09:30:00.000Z"),
  sampleProject("p2", "Social media", "2026-03-08T14:05:00.000Z"),
  sampleProject("p3", "Software house", "2026-02-28T11:20:00.000Z"),
];

const meta = {
  title: "Pages/Projects",
  component: ProjectsPage,
  parameters: {
    layout: "fullscreen",
  },
  // Controlled inputs: the component never touches the project store when
  // these are supplied, so the stories render deterministic fixtures.
  args: {
    loading: false,
    projects: [],
  },
} satisfies Meta<typeof ProjectsPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const WithProjects: Story = {
  args: {
    projects,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "Projects" }))
      .toBeInTheDocument();
    for (const project of projects) {
      await expect(canvas.getByText(project.name)).toBeInTheDocument();
    }
    await expect(canvas.getByRole("button", { name: "New project" }))
      .toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "New from example" }))
      .toBeInTheDocument();
  },
};

export const EmptyLanding: Story = {
  args: {
    projects: [],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "Rhizz" }))
      .toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: /Start from an example/ }),
    ).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: /New project/ }))
      .toBeInTheDocument();
  },
};

export const EmptyLandingOpensExampleModal: Story = {
  args: {
    projects: [],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: /Start from an example/ }),
    );
    await expect(
      await canvas.findByRole("heading", {
        name: "Choose an Example Architecture",
      }),
    ).toBeInTheDocument();
    // The bundled examples are listed with their descriptions.
    for (const example of get_example_projects()) {
      await expect(canvas.getByText(example.name)).toBeInTheDocument();
    }
  },
};
