import type { Meta, StoryObj } from "@storybook/svelte";
import { expect, within } from "storybook/test";
import type { Project } from "../vfs/types";
import AppContentShell from "./AppContentShell.svelte";
import ProjectsPage from "./ProjectsPage.svelte";
import { REPO_URL } from "../links";

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
  // tipIndex is pinned for the same reason — the Tips panel would otherwise
  // roll a random tip per mount and flake VRT baselines.
  args: {
    loading: false,
    projects: [],
    tipIndex: 0,
  },
} satisfies Meta<typeof ProjectsPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const WithProjects: Story = {
  args: {
    projects,
    // Injected so the footer renders without a server to ask (see BuildInfo).
    buildInfo: { git_sha: "07265fb" },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", { name: "Projects" }),
    ).toBeInTheDocument();
    for (const project of projects) {
      await expect(canvas.getByText(project.name)).toBeInTheDocument();
    }
    await expect(
      canvas.getByRole("button", { name: "New project" }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: "New from example" }),
    ).toBeInTheDocument();
    // Pinned tipIndex renders exactly one tip: the first entry. The tip is
    // Markdown-rendered, so assert on a plain fragment (markup splits the
    // text across elements).
    await expect(canvas.getByText(/single search box/)).toBeInTheDocument();

    // The build footer sits at the bottom of the list and links to its commit.
    const build = canvas.getByRole("link", { name: /rhizome build 07265fb/ });
    await expect(build).toHaveAttribute("href", `${REPO_URL}/commit/07265fb`);
  },
};

// The list's own empty state: the landing page lives at `/`, so `/projects`
// with nothing in it says so and offers to start a project right there.
export const EmptyProjects: Story = {
  decorators: [() => ({ Component: AppContentShell })],
  args: {
    projects: [],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", { name: "Projects" }),
    ).toBeInTheDocument();
    const empty = within(canvas.getByTestId("projects-empty"));
    await expect(empty.getByText("No projects yet")).toBeInTheDocument();
    await expect(
      empty.getByRole("button", { name: "New project" }),
    ).toBeInTheDocument();
    await expect(
      empty.getByRole("button", { name: "New from example" }),
    ).toBeInTheDocument();
    // The landing hero is not repeated here.
    await expect(
      canvas.queryByText(/Model your system architecture/),
    ).not.toBeInTheDocument();
    // The way back to the landing page.
    await expect(canvas.getByRole("link", { name: "Home" })).toHaveAttribute(
      "href",
      "/",
    );
  },
};

// The header stacks below the `sm` breakpoint so both actions sit under the
// "Projects" heading rather than running off the right edge — it overflows a
// phone-width card when they share a row. Storybook's test runner renders
// narrower than `sm`, so this story exercises the mobile layout.
export const MobileHeaderStacks: Story = {
  tags: ["no-vrt"],
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
