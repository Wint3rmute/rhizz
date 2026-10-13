import type { Meta, StoryObj } from "@storybook/svelte";
import { expect, waitFor, within } from "storybook/test";
import init from "rhizz";
import type { Project } from "../../../../vfs/types";
import { projectSlug } from "../../../../vfs/slug";
import {
  createProjectWithFiles,
  projectStore,
} from "../../../../ProjectState.svelte";
import CodePage from "./CodePageHost.svelte";
import { codePanes } from "./panes";

// Deterministic project ids so story args can be built synchronously at
// module scope while the async seeding runs lazily from loaders (top-level
// await in story files races the vitest-addon's test registration — see
// Explore.stories.ts).
const SEEDED_PROJECT_NAME = "Code page story";
// A project's id is the slug of its name (see vfs/slug), so a story derives
// its fixture id the same way the app does — synchronously, because the meta
// args below need it at module scope.
const SEEDED_PROJECT_ID = projectSlug(SEEDED_PROJECT_NAME);

// Small but complete: two leaf components with ports, one system wiring
// them — the same shape as the tour-walk fixture, plus a docs file and a
// second model file so the file tree has something to list.
const CODE_HCL = `project {
  name    = "code-demo"
  version = "0.1.0"
}

protocol "power" {
  full_name = "DC power delivery"
  roles     = ["provider", "consumer"]

  message "voltage" {
    full_name = "Current voltage reading"
    field "volts" {
      type = "float32"
      unit = "V"
    }
  }
}

component "battery" {
  full_name = "Main power source"
  leaf      = true

  port "power-out" {
    protocol = "power"
    role     = "provider"
    external = true
  }
}

component "controller" {
  full_name = "Processing hub"
  leaf      = true

  port "power-in" {
    protocol = "power"
    role     = "consumer"
    external = true
  }
}

system "demo-system" {
  full_name = "System using both definitions"

  instance "battery" {
    source = "battery"
  }

  instance "controller" {
    source = "controller"
  }

  connection "power-link" {
    from = "battery/power-out"
    to   = "controller/power-in"
  }
}
`;

async function ensureCodeProject(): Promise<Project> {
  await init();
  // A panes story may have persisted a hidden/resized sidebar — reset so
  // every story opens the default workspace.
  codePanes.forget();
  const existing = await projectStore.listProjects();
  const stale = existing.find((candidate) =>
    candidate.id === SEEDED_PROJECT_ID
  );
  if (stale !== undefined) {
    await projectStore.deleteProject(stale.id);
  }
  return await createProjectWithFiles(SEEDED_PROJECT_NAME, [
    { path: "main.hcl", content: CODE_HCL },
    { path: "docs/battery.md", content: "# Battery\n\nMain power source.\n" },
  ]);
}

const meta = {
  title: "Pages/Code",
  component: CodePage,
  parameters: {
    layout: "fullscreen",
  },
  args: {
    projectId: SEEDED_PROJECT_ID,
  },
} satisfies Meta<typeof CodePage>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The label Monaco puts on the hidden textarea it focuses. */
const EDITOR_CONTENT = "Editor content";

// The whole subpage: file sidebar beside the editor, the first `.hcl` file
// open. The editor paints asynchronously (lazily imported tokenizer chunk),
// so the play waits for real text the way the MonacoEditor stories do —
// otherwise the assertions below pass on an editor that never painted.
// Monaco only renders visible lines (virtualization), so the paint wait
// matches text at the top of the file, not the system block further down.
//
// The play also waits for the painted background to match the live panel
// tone: Monaco snapshots its theme at mount and re-snapshots on `data-theme`
// flips, and the flip can land after the mount (Storybook applies the theme
// asynchronously) — capturing or asserting before the re-snapshot would pin
// the stale theme instead of the story's own.
export const Default: Story = {
  loaders: [ensureCodeProject],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByRole("heading", { name: "Files" }),
    ).toBeVisible();
    const textarea = await canvas.findByLabelText(EDITOR_CONTENT);
    const editor = textarea.closest(".monaco-editor");
    if (!editor) throw new Error("the textarea should sit in a .monaco-editor");
    await waitFor(() => {
      void expect(editor.textContent).toMatch(/code-demo/);
    });
    // Computed colours come back in whatever notation the browser picked
    // (oklch for the probe, rgb for Monaco's inline style), so both are
    // normalised through a canvas pixel read before comparing — the same
    // trick the Code page's e2e tone test uses.
    const toPixel = (color: string) => {
      const offscreen = document.createElement("canvas");
      offscreen.width = offscreen.height = 1;
      const ctx = offscreen.getContext("2d");
      if (!ctx) throw new Error("no 2d context");
      ctx.fillStyle = "#000";
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      return Array.from(ctx.getImageData(0, 0, 1, 1).data).join(",");
    };
    const painted = editor.querySelector(".monaco-editor-background");
    if (!painted) throw new Error("Monaco should paint a background element");
    const probe = document.createElement("div");
    probe.className = "bg-base-100";
    canvasElement.appendChild(probe);
    const expected = toPixel(getComputedStyle(probe).backgroundColor);
    probe.remove();
    await waitFor(() => {
      void expect(toPixel(getComputedStyle(painted).backgroundColor)).toBe(
        expected,
      );
    });
    // The sidebar lists the seeded files.
    await expect(canvas.getByRole("button", { name: "main.hcl" }))
      .toBeVisible();
    await expect(canvas.getByText("battery.md")).toBeVisible();
  },
};
