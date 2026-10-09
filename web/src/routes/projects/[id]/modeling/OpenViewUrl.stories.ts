import type { Meta, StoryObj } from "@storybook/svelte";
import { expect, within } from "storybook/test";
import init from "rhizz";
import type { Project } from "../../../../vfs/types";
import { projectSlug } from "../../../../vfs/slug";
import {
  createProjectWithFiles,
  projectStore,
} from "../../../../ProjectState.svelte";
import DiagramPage from "./ModelingPage.svelte";
import { forgetLastView, rememberLastView } from "./lastView";

// The open view is named by the route's rest param, which arrives here as the
// `requestedView` prop — that is the whole contract a shared link exercises.
// These stories drive the prop directly (the router is mocked in Storybook),
// pinning the rules the page applies to it: a view that exists is opened, an
// unknown one falls back to the remembered view when it still exists (else
// the first view) rather than leaving the canvas empty.

const URL_PROJECT_NAME = "Open view story";
// A project's id is the slug of its name (see vfs/slug), so a story derives
// its fixture id the same way the app does — synchronously, because the meta
// args below need it at module scope.
const URL_PROJECT_ID = projectSlug(URL_PROJECT_NAME);

const URL_SYSTEM_HCL = `project {
  name = "open-view-story"
}

component "sensor" {
  full_name = "Reads the world"
  leaf      = true
}

component "actuator" {
  full_name = "Moves the world"
  leaf      = true
}

system "demo" {
  instance "sensor" {
    source = "sensor"
  }

  instance "actuator" {
    source = "actuator"
  }
}
`;

// Two views, so "the requested one" and "the first one" are different files —
// the fallback is only observable if the project has a second view to fall
// back *from*. Same canonical layout HCL the canvas itself writes (see
// persistence.ts's layoutToHcl), one placed node each.
function layoutHcl(name: string, x: number, y: number): string {
  return `view "${name}" {
  full_name = ""
  system      = "demo"

  node "demo/sensor" {
    x          = ${String(x)}
    y          = ${String(y)}
    width      = 160
    height     = 100
    text_align = "center"
  }
}
`;
}

async function ensureUrlProject(): Promise<Project> {
  await init();
  // Recreate from scratch every run: the editor seeds a view (and possibly the
  // model) on load, so an existing project can't be trusted to still match
  // the fixture below (same reasoning as DiagramPage.stories.ts). The
  // remembered last view is browser state, not project content, so it
  // survives the recreate under the reused id — forget it for hermetic
  // stories (each story sets its own memory explicitly when it needs one).
  forgetLastView(URL_PROJECT_ID);
  const existing = await projectStore.listProjects();
  const stale = existing.find((candidate) => candidate.id === URL_PROJECT_ID);
  if (stale !== undefined) {
    await projectStore.deleteProject(stale.id);
  }
  return await createProjectWithFiles(URL_PROJECT_NAME, [
    { path: "main.hcl", content: URL_SYSTEM_HCL },
    { path: "views/main.hcl", content: layoutHcl("main", 120, 120) },
    { path: "views/actuator.hcl", content: layoutHcl("actuator", 420, 300) },
  ]);
}

const meta = {
  title: "Pages/Diagrams/Open View URL",
  component: DiagramPage,
  parameters: {
    layout: "fullscreen",
  },
  args: {
    projectId: URL_PROJECT_ID,
  },
} satisfies Meta<typeof DiagramPage>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The open row in the Diagrams tree, by file name. */
async function openRow(
  canvas: ReturnType<typeof within>,
): Promise<HTMLElement | undefined> {
  await canvas.findByRole("button", { name: "main.hcl", exact: true });
  const rows: HTMLElement[] = canvas.getAllByRole("button", {
    name: /^[a-z-]+\.hcl$/,
  });
  return rows.find((row: HTMLElement) =>
    row.getAttribute("aria-current") === "true"
  );
}

/** A shared link to a view opens exactly that view, not the first one. */
export const DeepLinkedView: Story = {
  args: {
    requestedView: "actuator.hcl",
  },
  loaders: [ensureUrlProject],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByRole("button", { name: "Toggle Grid" });

    await expect(await openRow(canvas)).toHaveTextContent("actuator.hcl");
  },
};

/** A link to a view that no longer exists falls back to the first one. */
export const UnknownViewFallsBack: Story = {
  args: {
    requestedView: "renamed-away.hcl",
  },
  loaders: [ensureUrlProject],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByRole("button", { name: "Toggle Grid" });

    await expect(await openRow(canvas)).toHaveTextContent("main.hcl");
  },
};

/** An unknown link reopens the remembered view while it still exists. */
export const UnknownViewReopensRemembered: Story = {
  args: {
    requestedView: "renamed-away.hcl",
  },
  loaders: [
    async () => {
      const project = await ensureUrlProject();
      // The loader recreates the project but the memory under test is set
      // here, after the hermetic reset — this is the "visited actuator,
      // followed a stale link" session.
      rememberLastView(project.id, "actuator.hcl");
      return {};
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByRole("button", { name: "Toggle Grid" });

    await expect(await openRow(canvas)).toHaveTextContent("actuator.hcl");
  },
};
