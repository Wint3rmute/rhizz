import type { Meta, StoryObj } from "@storybook/svelte";
import { expect, within } from "storybook/test";
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

// The hero's cards are a `grid-cols-1 sm:grid-cols-2` grid, so below `sm`
// they become one column. Nothing pinned that, and it is easy to undo by
// lowering the breakpoint at which the row starts — three cards side by side
// at phone width is unreadable. `mobile1` is the same viewport the sibling
// MobileHeaderStacks story uses; VRT captures at 1280 wide, so without this
// story the stacked layout had no screenshot at all.
export const MobileLandingStacks: Story = {
  args: {
    projects: [],
  },
  globals: {
    viewport: { value: "mobile1" },
  },
  parameters: {
    viewport: { defaultViewport: "mobile1" },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const newProject = canvas.getByRole("button", { name: /New project/ });
    const fromExample = canvas.getByRole("button", {
      name: /Learn by example/,
    });
    const book = canvas.getByRole("link", { name: /Read the book/ });

    await expect(newProject).toBeInTheDocument();
    await expect(fromExample).toBeInTheDocument();
    await expect(book).toBeInTheDocument();

    // One column, not one row: each card starts below the previous card's
    // bottom edge. Comparing rects rather than reading the class list, so a
    // change that keeps `grid-cols-1` on the element but restructures the
    // grid still gets caught.
    await expect(
      fromExample.getBoundingClientRect().top,
    ).toBeGreaterThanOrEqual(newProject.getBoundingClientRect().bottom);
    await expect(book.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      fromExample.getBoundingClientRect().bottom,
    );
  },
};

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
  // With no projects the hero *is* the landing page, so this is the only place
  // its three cards are rendered. Previously this story asserted nothing,
  // which is why the set of entry points could change unnoticed.
  //
  // Content only. The two-column layout above `sm` — primary spanning both
  // columns, the two secondaries sharing the row beneath — cannot be measured
  // here: the viewport addon fills the preview area, which is ~414px under
  // Vitest, so `sm` never applies. It is pinned by this story's VRT baseline
  // instead (1280 wide), the same way MobileLandingStacks pins the stacked
  // layout's pixels.
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // A regex, not the sentence: the hero paragraph continues past this
    // clause, so an exact string match would never match the element.
    await expect(
      canvas.getByText(/Model your system architecture and verify it\./),
    ).toBeInTheDocument();

    await expect(
      canvas.getByRole("button", { name: /New project/ }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: /Learn by example/ }),
    ).toBeInTheDocument();

    // The book is the third way in. It leaves the app, so it is a link and
    // not a button — "link" is the honest role, and it is what makes
    // middle-click, focus order and the browser's own affordances work.
    const book = canvas.getByRole("link", { name: /Read the book/ });
    await expect(book).toBeInTheDocument();
    await expect(book).toHaveAttribute("href");
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
