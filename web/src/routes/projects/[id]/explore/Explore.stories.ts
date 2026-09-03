import type { Meta, StoryObj } from "@storybook/svelte";
import { expect, userEvent, within } from "storybook/test";
import init from "rhizz";
import type { Project } from "../../../../vfs/types";
import {
  createProjectWithFiles,
  createProjectWithMainFile,
  populateProjectFiles,
  projectStore,
} from "../../../../ProjectState.svelte";
import {
  EXAMPLE_SYSTEM_DIAGRAMS,
  EXAMPLE_SYSTEM_HCL,
} from "../../../../example_system";
import { get_example_projects } from "../../../../rhizz_wasm_wrapper";
import { openProjectFs } from "../../../../vfs/fs";
import { toastState } from "../../../../ToastState.svelte";
import {
  DIAGRAM_LAYOUT_DIR,
  type DiagramLayout,
  writeDiagramLayoutFile,
} from "../diagrams/persistence";
import { DOCS_DIR } from "./docs";
import Explore from "./Explore.svelte";

// ---------------------------------------------------------------------------
// Deterministic seeding contract.
//
// Storybook's vitest add-on registers one `test()` per story *while the story
// module evaluates*, and that registration only works when module evaluation
// is fully synchronous (top-level `await` races the browser runner's suite
// bookkeeping — see the "Vitest failed to find the current suite" flake).
// So nothing below awaits at module scope: async seeding is deferred into
// per-story `loaders`, and story `args` reference deterministic project ids
// derived here synchronously. Each seed looks up its project by that id and
// creates it (with the same id) only if missing, so repeated runs — module
// re-evaluation included — stay idempotent.
// ---------------------------------------------------------------------------

const SEEDED_PROJECT_ID = "story-explore-viewer";
const MANY_DIAGRAMS_PROJECT_ID = "story-explore-many-diagrams";
const CROSS_LEVEL_PROJECT_ID = "story-explore-cross-level";
const APOLLO_PROJECT_ID = "story-explore-apollo-11";
const SOFTWARE_HOUSE_PROJECT_ID = "story-explore-software-house";

const sampleOverview = EXAMPLE_SYSTEM_DIAGRAMS["overview.hcl"];
const sampleCloud = EXAMPLE_SYSTEM_DIAGRAMS["cloud-path.hcl"];

// The sampled layouts always exist in EXAMPLE_SYSTEM_DIAGRAMS; the fallbacks
// are only to keep the object total under noUncheckedIndexedAccess.
const EMPTY_LAYOUT: DiagramLayout = {
  checked: {},
  savedLayout: {},
  connections: {},
};

const manyDiagramsMap: Record<string, DiagramLayout> = {
  "overview.hcl": sampleOverview ?? EMPTY_LAYOUT,
  "cloud-path.hcl": sampleCloud ?? EMPTY_LAYOUT,
  "sensor-network.hcl": sampleOverview ?? EMPTY_LAYOUT,
  "power-distribution.hcl": sampleCloud ?? EMPTY_LAYOUT,
  "data-pipeline.hcl": sampleOverview ?? EMPTY_LAYOUT,
};

const CROSS_LEVEL_SYSTEM_HCL = `project {
  name    = "cross-level-demo"
  version = "0.1.0"
}

protocol "power" {
  description = "DC power delivery"
  roles       = ["provider", "consumer"]
}

protocol "spi" {
  description = "Serial peripheral interface"
  roles       = ["provider", "consumer"]
}

component "battery" {
  description = "Main power source"
  leaf        = true

  port "power-out" {
    protocol = "power"
    role     = "provider"
    external = true
  }
}

component "controller" {
  description = "Processing hub with internal MCU"
  leaf        = false

  port "power-in" {
    protocol = "power"
    role     = "consumer"
    external = true
  }

  instance "mcu" {
    source = "mcu"
  }
}

component "mcu" {
  description = "Microcontroller unit"
  leaf        = true

  port "spi" {
    protocol = "spi"
    role     = "provider"
    external = true
  }
}

component "sensor" {
  description = "External IMU sensor"
  leaf        = true

  port "spi" {
    protocol = "spi"
    role     = "consumer"
    external = true
  }
}

system "demo-system" {
  description = "System with sibling and non-sibling cross-level connections"

  instance "battery" {
    source = "battery"
  }

  instance "controller" {
    source = "controller"
  }

  instance "sensor" {
    source = "sensor"
  }

  # Sibling-level connection: battery to controller
  connection "power-link" {
    description = "Power delivery"
    from        = "battery/power-out"
    to          = "controller/power-in"
  }

  # Cross-level (non-sibling) connection: controller subcomponent to sibling sensor
  connection "sensor-bus" {
    description = "Cross-level SPI bus"
    from        = "controller/mcu/spi"
    to          = "sensor/spi"
  }
}

view "overview" {
  description = "Overview showing sibling and cross-level connections"
  system      = "demo-system"

  filter {
    max_level     = 2
    show_messages = true
  }
}
`;

const CROSS_LEVEL_SYSTEM_DIAGRAMS: Record<string, DiagramLayout> = {
  "overview.hcl": {
    checked: {
      "demo-system/battery": { x: 40, y: 80, width: 150, height: 90 },
      "demo-system/controller": {
        x: 250,
        y: 40,
        width: 230,
        height: 190,
        textAlign: "top-left",
      },
      "demo-system/controller/mcu": {
        x: 280,
        y: 100,
        width: 170,
        height: 90,
      },
      "demo-system/sensor": { x: 550, y: 90, width: 160, height: 90 },
    },
    savedLayout: {
      "demo-system/battery": { x: 40, y: 80, width: 150, height: 90 },
      "demo-system/controller": {
        x: 250,
        y: 40,
        width: 230,
        height: 190,
        textAlign: "top-left",
      },
      "demo-system/controller/mcu": {
        x: 280,
        y: 100,
        width: 170,
        height: 90,
      },
      "demo-system/sensor": { x: 550, y: 90, width: 160, height: 90 },
    },
  },
  "controller.hcl": {
    checked: {
      "demo-system/controller": {
        x: 40,
        y: 40,
        width: 230,
        height: 190,
        textAlign: "top-left",
      },
      "demo-system/controller/mcu": {
        x: 70,
        y: 100,
        width: 170,
        height: 90,
      },
    },
    savedLayout: {},
  },
};

async function ensureProjectWithDiagrams(
  id: string,
  name: string,
  diagrams: Record<string, DiagramLayout>,
  hclContent: string = EXAMPLE_SYSTEM_HCL,
) {
  await init();
  const existing = await projectStore.listProjects();
  const project = existing.find((p) => p.id === id) ??
    await createProjectWithMainFile(name, hclContent, id);
  const fs = openProjectFs(projectStore, project.id);
  for (const [dName, layout] of Object.entries(diagrams)) {
    await writeDiagramLayoutFile(fs, `${DIAGRAM_LAYOUT_DIR}/${dName}`, layout);
  }
  return project;
}

// --- "Viewer story": the main seeded project, plus a doc file for the
// sensor node so the hover popup has content to show. Docs are matched by
// the component's unique label, so the doc key is the label ("sensor"),
// not the full qualified path.
async function ensureSeededProject(): Promise<Project> {
  const project = await ensureProjectWithDiagrams(
    SEEDED_PROJECT_ID,
    "Viewer story",
    EXAMPLE_SYSTEM_DIAGRAMS,
  );
  const fs = openProjectFs(projectStore, project.id);
  await fs.mkdir(DOCS_DIR, { recursive: true });
  await fs.writeFile(
    `${DOCS_DIR}/sensor.md`,
    `# Sensor\n\nThe **environmental sensor** reads temperature and humidity over I2C.`,
  );
  return project;
}

async function ensureManyDiagramsProject(): Promise<Project> {
  return ensureProjectWithDiagrams(
    MANY_DIAGRAMS_PROJECT_ID,
    "Many diagrams story",
    manyDiagramsMap,
  );
}

async function ensureCrossLevelProject(): Promise<Project> {
  return ensureProjectWithDiagrams(
    CROSS_LEVEL_PROJECT_ID,
    "Cross level connections story",
    CROSS_LEVEL_SYSTEM_DIAGRAMS,
    CROSS_LEVEL_SYSTEM_HCL,
  );
}

async function ensureApolloProject(): Promise<Project | undefined> {
  const example = get_example_projects().find((e) => e.id === "apollo-11");
  const existing = await projectStore.listProjects();
  const project = existing.find((p) => p.id === APOLLO_PROJECT_ID);
  if (!project && example) {
    return createProjectWithFiles(
      "Apollo 11 story",
      example.files,
      APOLLO_PROJECT_ID,
    );
  }
  return project;
}

async function seedApolloProject(): Promise<void> {
  await ensureApolloProject();
  // Loaders in one array run concurrently, so the re-seed must not race
  // the ensure — it runs only after the project exists, and writeFile
  // updates (rather than re-creates) existing files.
  await init();
  const apolloExample = get_example_projects().find(
    (e) => e.id === "apollo-11",
  );
  if (apolloExample) {
    const fs = openProjectFs(projectStore, APOLLO_PROJECT_ID);
    await populateProjectFiles(fs, apolloExample.files);
  }
}

async function ensureSoftwareHouseProject(): Promise<Project | undefined> {
  const example = get_example_projects().find((e) => e.id === "software-house");
  const existing = await projectStore.listProjects();
  const project = existing.find((p) => p.id === SOFTWARE_HOUSE_PROJECT_ID);
  if (!project && example) {
    return createProjectWithFiles(
      "Software House story",
      example.files,
      SOFTWARE_HOUSE_PROJECT_ID,
    );
  }
  return project;
}

async function seedSoftwareHouseProject(): Promise<void> {
  await ensureSoftwareHouseProject();
  await init();
  const softwareHouseExample = get_example_projects().find(
    (e) => e.id === "software-house",
  );
  if (softwareHouseExample) {
    const fs = openProjectFs(projectStore, SOFTWARE_HOUSE_PROJECT_ID);
    await populateProjectFiles(fs, softwareHouseExample.files);
  }
}

const meta = {
  title: "Pages/Explore",
  component: Explore,
  parameters: {
    layout: "fullscreen",
  },
  args: {
    projectId: SEEDED_PROJECT_ID,
  },
} satisfies Meta<typeof Explore>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Desktop: Story = {
  parameters: {
    viewport: { defaultViewport: "responsive" },
  },
  loaders: [ensureSeededProject],
};

export const Mobile: Story = {
  globals: {
    viewport: { value: "mobile1" },
  },
  parameters: {
    viewport: { defaultViewport: "mobile1" },
  },
  loaders: [ensureSeededProject],
};

export const MobileManyDiagrams: Story = {
  globals: {
    viewport: { value: "mobile1" },
  },
  parameters: {
    viewport: { defaultViewport: "mobile1" },
  },
  args: {
    projectId: MANY_DIAGRAMS_PROJECT_ID,
  },
  loaders: [ensureManyDiagramsProject],
};

export const CrossLevelConnections: Story = {
  parameters: {
    viewport: { defaultViewport: "responsive" },
  },
  args: {
    projectId: CROSS_LEVEL_PROJECT_ID,
  },
  loaders: [ensureCrossLevelProject],
};

export const DrillDownNavigation: Story = {
  args: {
    projectId: CROSS_LEVEL_PROJECT_ID,
  },
  loaders: [ensureCrossLevelProject],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const controller = await canvas.findByRole("link", {
      name: /controller, open detailed view/i,
    });
    await userEvent.click(controller);
    await expect(controller).toHaveAccessibleName(
      /controller, open detailed view/i,
    );
    await expect(
      toastState.toasts.some(
        (toast) => toast.message === "No detailed view for controller created",
      ),
    ).toBe(false);
  },
};

export const MissingDetailToast: Story = {
  args: {
    projectId: CROSS_LEVEL_PROJECT_ID,
  },
  loaders: [ensureCrossLevelProject],
  play: async ({ canvasElement }) => {
    for (const toast of [...toastState.toasts]) toastState.dismiss(toast.id);
    const canvas = within(canvasElement);
    const sensor = await canvas.findByRole("link", {
      name: /sensor, no detailed view/i,
    });
    await userEvent.click(sensor);
    await expect(
      toastState.toasts.some(
        (toast) => toast.message === "No detailed view for sensor created",
      ),
    ).toBe(true);
  },
};

export const BreadcrumbNavigation: Story = {
  args: {
    projectId: CROSS_LEVEL_PROJECT_ID,
  },
  loaders: [ensureCrossLevelProject],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const breadcrumb = await canvas.findByRole("navigation", {
      name: "Diagram breadcrumb",
    });
    await expect(within(breadcrumb).getByText("Explore")).toBeInTheDocument();
    await expect(within(breadcrumb).getByText(/overview|controller/))
      .toBeInTheDocument();
  },
};

export const EmbedDiagramButton: Story = {
  args: {
    projectId: SEEDED_PROJECT_ID,
    // Pin a deterministic origin so the embed URL in this story is stable
    // across runs — Chromatic runners each get a different window.location.
    embedBaseUrl: "https://rhizz.example.dev",
  },
  loaders: [ensureSeededProject],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // The embed button sits in the top bar of the Explore view.
    const button = await canvas.findByRole("button", {
      name: /embed diagram/i,
    });
    await expect(button).toBeInTheDocument();
    await userEvent.click(button);
    // The modal opens with the direct embed URL and iframe snippet.
    await expect(
      await canvas.findByText("Direct Embed URL"),
    ).toBeInTheDocument();
    await expect(
      await canvas.findByText("HTML <iframe> Embed Code"),
    ).toBeInTheDocument();
  },
};

export const Apollo11: Story = {
  parameters: {
    viewport: { defaultViewport: "responsive" },
  },
  args: {
    projectId: APOLLO_PROJECT_ID,
  },
  loaders: [seedApolloProject],
};

export const SoftwareHouse: Story = {
  parameters: {
    viewport: { defaultViewport: "responsive" },
  },
  args: {
    projectId: SOFTWARE_HOUSE_PROJECT_ID,
  },
  loaders: [seedSoftwareHouseProject],
};

export const HoverDocPopup: Story = {
  args: {
    projectId: SEEDED_PROJECT_ID,
  },
  loaders: [ensureSeededProject],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // The sensor node has a doc seeded for it; hovering should surface it.
    const sensor = await canvas.findByRole("link", {
      name: /sensor/i,
    });
    await userEvent.hover(sensor);

    await expect(
      await canvas.findByText((content) =>
        content.includes("environmental sensor")
      ),
    ).toBeInTheDocument();
  },
};
