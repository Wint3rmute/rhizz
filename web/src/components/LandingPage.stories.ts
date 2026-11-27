import type { Meta, StoryObj } from "@storybook/svelte";
import { expect, within } from "storybook/test";
import AppContentShell from "./AppContentShell.svelte";
import LandingPage from "./LandingPage.svelte";

const meta = {
  title: "Pages/Landing",
  component: LandingPage,
  parameters: {
    layout: "fullscreen",
  },
  // Rendered inside the app content shell: without a definite-height parent
  // the hero is content-height and the full-page capture pads the rest with
  // white. The shell reproduces the running app, so the card sits centered
  // with even margins — the shot used for README/docs.
  decorators: [() => ({ Component: AppContentShell })],
  // Controlled: the page never reads the project store when a count is given.
  args: {
    projectCount: 0,
  },
} satisfies Meta<typeof LandingPage>;

export default meta;

type Story = StoryObj<typeof meta>;

function cards(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  return {
    newProject: canvas.getByRole("button", { name: /New project/ }),
    projects: canvas.getByRole("link", { name: /Your projects/ }),
    example: canvas.getByRole("button", { name: /Learn by example/ }),
    book: canvas.getByRole("link", { name: /Read the book/ }),
  };
}

// First visit: nothing created yet. Also the source of the README/book hero
// (`just assets`), captured at FullHD (see vrt/stories.spec.ts).
export const NoProjects: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // A regex, not the sentence: the hero paragraph continues past this
    // clause, so an exact string match would never match the element.
    await expect(
      canvas.getByText(/Model your system architecture and verify it\./),
    ).toBeInTheDocument();
    await expect(canvas.getByTestId("landing-logo")).toBeInTheDocument();

    const { projects, book } = cards(canvasElement);
    // The projects card stays, and says there is nothing in it yet.
    await expect(projects).toHaveTextContent("No projects yet");
    await expect(projects).toHaveAttribute("href", "/projects");
    // The book leaves the app, so it is a link and not a button.
    await expect(book).toHaveAttribute("href");
  },
};

export const WithProjects: Story = {
  tags: ["no-vrt"],
  args: {
    projectCount: 3,
  },
  play: async ({ canvasElement }) => {
    const { projects } = cards(canvasElement);
    await expect(projects).toHaveTextContent("3 projects");
  },
};

// The four cards are a 2x2 grid at every width, phones included. Storybook's
// test runner renders ~414px wide, so this also pins the phone layout; the
// VRT baseline at `mobile1` keeps its pixels.
export const MobileGrid: Story = {
  globals: {
    viewport: { value: "mobile1" },
  },
  parameters: {
    viewport: { defaultViewport: "mobile1" },
  },
  play: async ({ canvasElement }) => {
    const { newProject, projects, example, book } = cards(canvasElement);
    const [a, b, c, d] = [newProject, projects, example, book].map((el) =>
      el.getBoundingClientRect(),
    );
    if (!a || !b || !c || !d) throw new Error("cards not laid out");

    // Top row: New project | Your projects. Bottom row: example | book.
    await expect(Math.abs(a.top - b.top)).toBeLessThanOrEqual(1);
    await expect(Math.abs(c.top - d.top)).toBeLessThanOrEqual(1);
    await expect(b.left).toBeGreaterThanOrEqual(a.right);
    await expect(c.top).toBeGreaterThanOrEqual(a.bottom);
    // Equal cards: none of them spans the row as a primary action.
    await expect(Math.abs(a.width - b.width)).toBeLessThanOrEqual(1);

    // On a phone the card is taller than the screen: it must scroll, not be
    // clipped. A vertically centred, fixed-height hero pushed its top (the
    // logo) above the page, out of reach.
    const logo = within(canvasElement).getByTestId("landing-logo");
    await expect(logo.getBoundingClientRect().top).toBeGreaterThanOrEqual(0);
  },
};
