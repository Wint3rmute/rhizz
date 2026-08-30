import type { Meta, StoryObj } from "@storybook/svelte";
import { expect, waitFor, within } from "storybook/test";
import init from "rhizz";
import type { Project } from "../../../../vfs/types";
import {
  createProjectWithFiles,
  projectStore,
} from "../../../../ProjectState.svelte";
import DiagramPage from "./+page.svelte";

await init();

// Storybook groups every story in a file under its default meta, so the
// grid stories deliberately live in their own file with their own meta —
// and every grid story passes its args explicitly, so a story can never
// inherit the wrong project from a sibling meta.

// A small but *valid* project whose components sit far enough apart (one at
// 100,100, one at 1050,1050) that the canvas, once zoomed to fit, crosses
// both a 100-unit and a 1000-unit graduation line — letting the graduated
// line weights/opacities be seen side by side.
const GRID_SYSTEM_HCL = `project {
  name = "graduated-grid-story"
}

protocol "tcp" {
  roles = ["provider", "consumer"]

  message "data" {
    field "payload" {
      type = "string"
    }
  }
}

system "demo" {
  component "gateway" {
    leaf = true

    port "api" {
      protocol = "tcp"
      role     = "provider"
    }
  }

  component "database" {
    leaf = true

    port "api" {
      protocol = "tcp"
      role     = "consumer"
    }
  }

  connection "gw-db" {
    from = "gateway/api"
    to   = "database/api"
  }
}
`;

// Layout file seeded in the same canonical HCL the canvas itself writes
// (see persistence.ts's layoutToHcl): one view with two placed nodes.
// Coordinates deliberately cross a 1000-unit graduation line (x/y = 1000).
const GRID_VIEWS_HCL = `view "main" {
  description = ""
  system      = "demo"

  node "demo/gateway" {
    x          = 100
    y          = 100
    width      = 100
    height     = 100
    text_align = "center"
  }

  node "demo/database" {
    x          = 1050
    y          = 1050
    width      = 100
    height     = 100
    text_align = "center"
  }
}
`;

async function ensureGridProject(): Promise<Project> {
  // Recreate from scratch every run: the diagram page mutates its own
  // diagram file (and stale localStorage from earlier test runs can linger
  // in the shared chromium profile), so an existing project can't be
  // trusted to still match the fixtures below.
  const existing = await projectStore.listProjects();
  const stale = existing.find((candidate) =>
    candidate.name === "Graduated grid story"
  );
  if (stale !== undefined) {
    await projectStore.deleteProject(stale.id);
  }
  return createProjectWithFiles("Graduated grid story", [
    { path: "system.hcl", content: GRID_SYSTEM_HCL },
    { path: "diagrams/main.hcl", content: GRID_VIEWS_HCL },
  ]);
}

const gridProject: Project = await ensureGridProject();

const meta = {
  title: "Pages/Diagrams/Grid Graduations",
  component: DiagramPage,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof DiagramPage>;

export default meta;

type Story = StoryObj<typeof meta>;

function backgroundRect(canvasElement: HTMLElement): Element | null {
  // The background rect is the one whose fill references the graduated grid
  // pattern (url(#Grid-…)) while *not* being inside a pattern itself — the
  // tile <rect>s nested in each coarser pattern also carry such fills.
  return (
    Array.from(canvasElement.querySelectorAll("rect")).find((r) =>
      r.closest("pattern") === null &&
      (r.getAttribute("fill") ?? "").startsWith("url(#Grid-")
    ) ?? null
  );
}

function patternIds(canvasElement: HTMLElement): string[] {
  return Array.from(canvasElement.querySelectorAll("pattern")).map(
    (p) => p.getAttribute("id") ?? "",
  );
}

/** Editor window with the Grid option enabled (it is on by default). */
export const GridGraduationsEnabled: Story = {
  args: {
    params: {
      id: gridProject.id,
    },
    data: {
      projectId: gridProject.id,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // The canvas (and its floating toolbar) mounts asynchronously: the page
    // first loads the project sources / diagram list, then renders the SVG.
    await canvas.findByRole("button", { name: "Toggle Grid" });

    // All three graduation levels are declared as SVG patterns.
    const ids = patternIds(canvasElement);
    await expect(ids).toContain("Grid-g10");
    await expect(ids).toContain("Grid-g100");
    await expect(ids).toContain("Grid-g1000");

    // The coarser patterns stack on the finer ones (fill chain), and the
    // background rect fills with the coarsest level.
    const g100 = canvasElement.querySelector("#Grid-g100");
    await expect(g100?.querySelector("rect")?.getAttribute("fill"))
      .toBe("url(#Grid-g10)");
    const g1000 = canvasElement.querySelector("#Grid-g1000");
    await expect(g1000?.querySelector("rect")?.getAttribute("fill"))
      .toBe("url(#Grid-g100)");
    await expect(backgroundRect(canvasElement)?.getAttribute("fill"))
      .toBe("url(#Grid-g1000)");

    // The two placed components render (both sides of the 1000 line). The
    // sidebar hierarchy tree also lists each component, so multiple matches
    // are expected — assert at least one rendered instance of each label.
    const gw = await canvas.findAllByText("gateway");
    await expect(gw.length).toBeGreaterThan(0);
    const db = await canvas.findAllByText("database");
    await expect(db.length).toBeGreaterThan(0);
  },
};

/** Same editor window with the grid toggled off — background goes transparent. */
export const GridToggledOff: Story = {
  args: {
    params: {
      id: gridProject.id,
    },
    data: {
      projectId: gridProject.id,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Starts enabled, like the previous story.
    await canvas.findByRole("button", { name: "Toggle Grid" });
    await expect(backgroundRect(canvasElement)?.getAttribute("fill"))
      .toBe("url(#Grid-g1000)");

    const toggle = await canvas.findByRole("button", { name: "Toggle Grid" });
    toggle.click();
    // With the grid hidden the background rect no longer references any
    // Grid pattern (its fill is "transparent"), so the helper finds none.
    // waitFor: Svelte flushes the state change on a microtask, so the DOM
    // may lag a tick behind the click.
    await waitFor(async () => {
      await expect(backgroundRect(canvasElement)).toBeNull();
    });

    // Clicking again restores the graduated grid.
    toggle.click();
    await waitFor(async () => {
      await expect(backgroundRect(canvasElement)?.getAttribute("fill"))
        .toBe("url(#Grid-g1000)");
    });
  },
};
