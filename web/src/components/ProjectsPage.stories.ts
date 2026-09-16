import type { Meta, StoryObj } from "@storybook/svelte";
import { expect, userEvent, within } from "storybook/test";
import { get_example_projects } from "../rhizz_wasm_wrapper";
import type { Project } from "../vfs/types";
import ProjectsPage from "./ProjectsPage.svelte";

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

// The header stacks below the `sm` breakpoint so both actions sit under the
// "Projects" heading rather than running off the right edge — it overflows a
// phone-width card when they share a row. Storybook's test runner renders
// narrower than `sm`, so this story exercises the mobile layout.
export const MobileHeaderStacks: Story = {
  args: {
    projects,
  },
  globals: {
    viewport: { value: "mobile1" },
  },
  parameters: {
    viewport: { defaultViewport: "mobile1" },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const heading = canvas.getByRole("heading", { name: "Projects" });
    const header = heading.closest("div");
    if (!header) throw new Error("the heading should have a header container");

    const newFromExample = within(header).getByRole("button", {
      name: "New from example",
    });
    const newProject = within(header).getByRole("button", {
      name: "New project",
    });

    // Both actions belong to the header...
    await expect(newFromExample).toBeInTheDocument();
    // ...and sit below the heading instead of beside it.
    await expect(newProject.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      heading.getBoundingClientRect().bottom,
    );
  },
};
