import type { Meta, StoryObj } from "@storybook/svelte";
import { expect, userEvent, within } from "storybook/test";
import init from "rhizz";
import type { Project } from "../../../../vfs/types";
import {
  createProjectWithFiles,
  projectStore,
} from "../../../../ProjectState.svelte";
import { get_example_projects } from "../../../../rhizz_wasm_wrapper";
import { openProjectFs } from "../../../../vfs/fs";
import {
  DIAGRAM_LAYOUT_DIR,
  type DiagramLayout,
  writeDiagramLayoutFile,
} from "../diagrams/persistence";
import Inventory from "./Inventory.svelte";

// Deterministic project ids so story args can be built synchronously at
// module scope while the async seeding runs lazily from loaders (top-level
// await in story files races the vitest-addon's test registration — see
// Explore.stories.ts).
const SEEDED_PROJECT_ID = "story-inventory-main";
const EMPTY_PROJECT_ID = "story-inventory-empty";
const APOLLO_PROJECT_ID = "story-inventory-apollo";

// A small definitions-first model: three top-level definitions with mixed
// completion, plus a system that instantiates two of them.
const INVENTORY_HCL = `project {
  name    = "inventory-demo"
  version = "0.1.0"
}

protocol "power" {
  description = "DC power delivery"
  roles       = ["provider", "consumer"]

  message "voltage" {
    description = "Current voltage reading"
    field "volts" {
      type = "float32"
      unit = "V"
    }
  }
}

component "battery" {
  description = "Main power source with a description"
  leaf        = true

  port "power-out" {
    protocol = "power"
    role     = "provider"
  }
}

component "controller" {
  description = "Processing hub"
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
  description = "System using two of the definitions"

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
    savedLayout: {},
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
    savedLayout: {},
  },
};

async function ensureInventoryProject(): Promise<Project> {
  await init();
  const existing = await projectStore.listProjects();
  const project = existing.find((p) => p.id === SEEDED_PROJECT_ID) ??
    await createProjectWithFiles(
      "Inventory story",
      [{ path: "main.hcl", content: INVENTORY_HCL }],
      SEEDED_PROJECT_ID,
    );
  const fs = openProjectFs(projectStore, project.id);
  for (const [dName, layout] of Object.entries(DEFINITION_DIAGRAMS)) {
    await writeDiagramLayoutFile(fs, `${DIAGRAM_LAYOUT_DIR}/${dName}`, layout);
  }
  return project;
}

// An empty project: no definitions at all.
async function ensureEmptyProject(): Promise<Project> {
  const existing = await projectStore.listProjects();
  return existing.find((p) => p.id === EMPTY_PROJECT_ID) ??
    await createProjectWithFiles(
      "Inventory empty story",
      [{ path: "main.hcl", content: 'project {\n  name    = "empty"\n}\n' }],
      EMPTY_PROJECT_ID,
    );
}

async function ensureApolloProject(): Promise<Project | undefined> {
  await init();
  const example = get_example_projects().find((e) => e.id === "apollo-11");
  const existing = await projectStore.listProjects();
  const existingProject = existing.find((p) => p.id === APOLLO_PROJECT_ID);
  if (existingProject || !example) return existingProject;
  return await createProjectWithFiles(APOLLO_PROJECT_ID, example.files);
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
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // All four definitions are listed; instances are not.
    await expect(canvas.getAllByTestId("inventory-card")).toHaveLength(4);
    await expect(canvas.getByText("draft-module")).toBeTruthy();
  },
};

export const Mobile: Story = {
  globals: {
    viewport: { value: "mobile1" },
  },
  parameters: {
    viewport: { defaultViewport: "mobile1" },
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
      canvas.getByText(/diagrams\/draft-module\.hcl/),
    ).toBeTruthy();
  },
};

export const EmptyModel: Story = {
  args: {
    projectId: EMPTY_PROJECT_ID,
  },
  loaders: [ensureEmptyProject],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByText(/No component definitions in this model yet/),
    ).toBeTruthy();
  },
};

export const Apollo11: Story = {
  args: {
    projectId: APOLLO_PROJECT_ID,
  },
  loaders: [ensureApolloProject],
};
