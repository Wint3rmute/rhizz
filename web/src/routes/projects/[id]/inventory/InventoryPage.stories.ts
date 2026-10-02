import type { Meta, StoryObj } from "@storybook/svelte";
import { expect, userEvent, waitFor, within } from "storybook/test";
import init from "rhizz";
import type { Project } from "../../../../vfs/types";
import { projectSlug } from "../../../../vfs/slug";
import {
  createProjectWithFiles,
  projectStore,
} from "../../../../ProjectState.svelte";
import { openProjectFs } from "../../../../vfs/fs";
import {
  type DiagramLayout,
  VIEW_LAYOUT_DIR,
  writeDiagramLayoutFile,
} from "../modeling/persistence";
import Inventory from "./Inventory.svelte";

// Deterministic project ids so story args can be built synchronously at
// module scope while the async seeding runs lazily from loaders (top-level
// await in story files races the vitest-addon's test registration — see
// Explore.stories.ts).
const SEEDED_PROJECT_NAME = "Inventory story";
// A project's id is the slug of its name (see vfs/slug), so a story derives
// its fixture id the same way the app does — synchronously, because the meta
// args below need it at module scope.
const SEEDED_PROJECT_ID = projectSlug(SEEDED_PROJECT_NAME);
const EMPTY_PROJECT_NAME = "Inventory empty story";
// A project's id is the slug of its name (see vfs/slug), so a story derives
// its fixture id the same way the app does — synchronously, because the meta
// args below need it at module scope.
const EMPTY_PROJECT_ID = projectSlug(EMPTY_PROJECT_NAME);

// A small definitions-first model: three top-level definitions with mixed
// completion, plus a system that instantiates two of them.
const INVENTORY_HCL = `project {
  name    = "inventory-demo"
  version = "0.1.0"
}

protocol "power" {
  full_name = "DC power delivery"
  roles       = ["provider", "consumer"]

  message "voltage" {
    full_name = "Current voltage reading"
    field "volts" {
      type = "float32"
      unit = "V"
    }
  }
}

component "battery" {
  full_name = "Main power source with a full name"
  leaf        = true

  port "power-out" {
    protocol = "power"
    role     = "provider"
  }
}

component "controller" {
  full_name = "Processing hub"
  leaf        = false

  instance "mcu" {
    source = "mcu"
  }
}

component "mcu" {
  leaf = true

  port "spi" {
    protocol = "power"
    role     = "provider"
  }
}

component "draft-module" {
  leaf = false
}

system "demo-system" {
  full_name = "System using two of the definitions"

  instance "battery" {
    source = "battery"
  }

  instance "controller" {
    source = "controller"
  }

  connection "power-link" {
    from = "battery/power-out"
    to   = "controller/mcu/spi"
  }
}
`;

// Default view diagrams for two of the three definitions — "draft-module"
// intentionally has none, so it shows the empty state.
const DEFINITION_DIAGRAMS: Record<string, DiagramLayout> = {
  "battery.hcl": {
    checked: {
      "demo-system/battery": { x: 60, y: 60, width: 160, height: 100 },
    },
  },
  "controller.hcl": {
    checked: {
      "demo-system/controller": {
        x: 40,
        y: 40,
        width: 260,
        height: 220,
        textAlign: "top-left",
      },
      "demo-system/controller/mcu": { x: 80, y: 110, width: 170, height: 100 },
    },
  },
};

async function ensureInventoryProject(): Promise<Project> {
  await init();
  const existing = await projectStore.listProjects();
  const project = existing.find((p) => p.id === SEEDED_PROJECT_ID) ??
    await createProjectWithFiles(
      SEEDED_PROJECT_NAME,
      [{ path: "main.hcl", content: INVENTORY_HCL }],
    );
  const fs = openProjectFs(projectStore, project.id);
  for (const [dName, layout] of Object.entries(DEFINITION_DIAGRAMS)) {
    await writeDiagramLayoutFile(fs, `${VIEW_LAYOUT_DIR}/${dName}`, layout);
  }
  // Seeded documentation for battery (controller/mcu/draft-module have none).
  await fs.mkdir("docs", { recursive: true });
  await fs.writeFile("docs/battery.md", "# Battery\n\nMain power source.\n");
  return project;
}

// An empty project: no definitions at all.
async function ensureEmptyProject(): Promise<Project> {
  const existing = await projectStore.listProjects();
  return existing.find((p) => p.id === EMPTY_PROJECT_ID) ??
    await createProjectWithFiles(
      EMPTY_PROJECT_NAME,
      [{ path: "main.hcl", content: 'project {\n  name    = "empty"\n}\n' }],
    );
}

const meta = {
  title: "Pages/Inventory",
  component: Inventory,
  parameters: {
    layout: "fullscreen",
  },
  args: {
    projectId: SEEDED_PROJECT_ID,
  },
} satisfies Meta<typeof Inventory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Desktop: Story = {
  parameters: {
    viewport: { defaultViewport: "responsive" },
  },
  loaders: [ensureInventoryProject],
};

export const MissingDefaultDiagram: Story = {
  loaders: [ensureInventoryProject],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const card = canvas.getByText("draft-module");
    await userEvent.click(card);
    await expect(
      canvas.getByTestId("inventory-empty-diagram"),
    ).toBeTruthy();
    await expect(
      canvas.getByText(/views\/draft-module\.hcl/),
    ).toBeTruthy();
    await expect(
      canvas.getByTestId("inventory-create-view"),
    ).toBeTruthy();
    await expect(
      canvas.getByRole("button", { name: "Create a view for this component" }),
    ).toBeTruthy();
  },
};

// Presses "Edit" and waits for Monaco to exist. Its *content* is asserted in
// e2e: this browser is ~414px wide, where the editor box collapses to zero and
// Monaco paints nothing, so a content assertion here would pass vacuously.
async function openDocEditor(canvas: ReturnType<typeof within>) {
  await userEvent.click(await canvas.findByTestId("inventory-doc-edit-button"));
  const host = canvas.getByTestId("inventory-doc-editor");
  // Monaco's input, by the aria label it gives itself (the default of its
  // `ariaLabel` option) — this version also keeps a hidden IME textarea.
  await waitFor(() => {
    void expect(host.querySelector('[aria-label="Editor content"]'))
      .toBeTruthy();
  });
}

export const DocumentationTab: Story = {
  loaders: [ensureInventoryProject],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // battery is selected by default; its seeded docs/battery.md renders
    // as Markdown in the Full name tab (read-only here — e2e covers save).
    await canvas.findByTestId("inventory-doc-viewer");
    await expect(
      canvas.getByRole("heading", { name: "Battery" }),
    ).toBeTruthy();

    // "Edit" swaps the rendered doc for the app's editor — the same Monaco
    // component the Code page uses for these very files.
    await openDocEditor(canvas);
    await userEvent.click(canvas.getByTestId("inventory-doc-cancel-button"));
    await expect(
      canvas.getByRole("heading", { name: "Battery" }),
    ).toBeTruthy();
  },
};

export const EmptyModel: Story = {
  args: {
    projectId: EMPTY_PROJECT_ID,
  },
  loaders: [ensureEmptyProject],
};

// A shared link to an entity opens exactly that entity. The requested one is
// deliberately not the first card, so this can't pass by accident on the same
// entity a bare /inventory would have opened.
export const DeepLinkedEntity: Story = {
  args: {
    requestedLabel: "draft-module",
  },
  loaders: [ensureInventoryProject],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const cards = await canvas.findAllByTestId("inventory-card");
    const pressed = cards.filter((card) =>
      card.getAttribute("aria-pressed") === "true"
    );
    await expect(pressed).toHaveLength(1);
    await expect(pressed[0]).toHaveTextContent("draft-module");
    // "battery" is the first definition — what a bare /inventory opens.
    const batteryIsOpen = cards.some(
      (card) =>
        card.getAttribute("aria-pressed") === "true" &&
        card.textContent.includes("battery"),
    );
    await expect(batteryIsOpen).toBe(false);
    // ...and the detail pane follows: draft-module is the definition without a
    // default view, so its preview shows the empty state.
    await expect(canvas.getByTestId("inventory-empty-diagram")).toBeTruthy();
  },
};

// The detail pane is a column beside the diagram preview, not a strip under
// it. That arrangement is a `md:` one, and the Vitest story browser is ~414px
// wide — `md:` never applies here — so the side-by-side geometry cannot be
// measured in a story: it is pinned by this file's VRT baselines (1280 wide)
// and by the e2e spec, which runs at Playwright's desktop default.
//
// What *is* measurable is the narrow fallback: below `md` the pane goes back
// under the diagram. Asserted as computed flex-direction on the shared row
// plus the two rects not overlapping, so neither can drift on its own — a pane
// that kept a fixed width would still be beside the diagram without changing
// what the row says, and vice versa.
export const DetailPaneStacksBelowTheDiagram: Story = {
  loaders: [ensureInventoryProject],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const diagram = await canvas.findByTestId("inventory-diagram");
    const pane = canvas.getByTestId("inventory-detail-pane");
    const row = diagram.parentElement;
    if (!row) {
      throw new Error("the diagram preview should sit in the main row");
    }

    await expect(getComputedStyle(row).flexDirection).toBe("column");
    // The 1px slack absorbs sub-pixel rounding of the stacked heights.
    await expect(pane.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      diagram.getBoundingClientRect().bottom - 1,
    );
  },
};

// The documentation editor, open. Every other documentation story cancels back
// to the viewer, so without this one the editor's own layout inside the pane —
// its height, its border, where the Save/Cancel row sits — has no picture of it
// at all: a story that ends in edit mode is the only place the pane as a whole
// can be compared.
export const DocumentationEditorOpen: Story = {
  loaders: [ensureInventoryProject],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await openDocEditor(canvas);
    // Save and Cancel stay reachable below it.
    await expect(canvas.getByTestId("inventory-doc-save-button")).toBeTruthy();
    await expect(canvas.getByTestId("inventory-doc-cancel-button"))
      .toBeTruthy();
  },
};
