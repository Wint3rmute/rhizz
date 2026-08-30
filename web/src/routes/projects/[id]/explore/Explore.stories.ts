import type { Meta, StoryObj } from "@storybook/svelte";
import { expect, userEvent, within } from "storybook/test";
import init from "rhizz";
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

// Initialize WASM module before evaluating story models
await init();

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

system "demo-system" {
  description = "System with sibling and non-sibling cross-level connections"

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

    component "mcu" {
      description = "Microcontroller unit"
      leaf        = true

      port "spi" {
        protocol = "spi"
        role     = "provider"
        external = true
      }
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
  name: string,
  diagrams: Record<string, DiagramLayout>,
  hclContent: string = EXAMPLE_SYSTEM_HCL,
) {
  const existing = await projectStore.listProjects();
  let project = existing.find((p) => p.name === name);
  project ??= await createProjectWithMainFile(name, hclContent);
  const fs = openProjectFs(projectStore, project.id);
  for (const [dName, layout] of Object.entries(diagrams)) {
    await writeDiagramLayoutFile(fs, `${DIAGRAM_LAYOUT_DIR}/${dName}`, layout);
  }
  return project;
}

const seededProject = await ensureProjectWithDiagrams(
  "Viewer story",
  EXAMPLE_SYSTEM_DIAGRAMS,
);

// Seed a doc for one component so the hover popup has content to show. Docs
// are matched by the component's unique label, so the doc key is the label
// ("sensor"), not the full qualified path.
const fs = openProjectFs(projectStore, seededProject.id);
await fs.mkdir(DOCS_DIR, { recursive: true });
await fs.writeFile(
  `${DOCS_DIR}/sensor.md`,
  `# Sensor\n\nThe **environmental sensor** reads temperature and humidity over I2C.`,
);

const manyDiagramsProject = await ensureProjectWithDiagrams(
  "Many diagrams story",
  manyDiagramsMap,
);

const crossLevelProject = await ensureProjectWithDiagrams(
  "Cross level connections story",
  CROSS_LEVEL_SYSTEM_DIAGRAMS,
  CROSS_LEVEL_SYSTEM_HCL,
);

const apolloExample = get_example_projects().find((e) => e.id === "apollo-11");
const softwareHouseExample = get_example_projects().find(
  (e) => e.id === "software-house",
);

async function ensureApolloProject() {
  const existing = await projectStore.listProjects();
  let project = existing.find((p) => p.name === "Apollo 11 story");
  if (!project && apolloExample) {
    project = await createProjectWithFiles(
      "Apollo 11 story",
      apolloExample.files,
    );
  }
  return project;
}

async function ensureSoftwareHouseProject() {
  const existing = await projectStore.listProjects();
  let project = existing.find((p) => p.name === "Software House story");
  if (!project && softwareHouseExample) {
    project = await createProjectWithFiles(
      "Software House story",
      softwareHouseExample.files,
    );
  }
  return project;
}

const apolloProject = await ensureApolloProject();
const softwareHouseProject = await ensureSoftwareHouseProject();

const meta = {
  title: "Pages/Explore",
  component: Explore,
  parameters: {
    layout: "fullscreen",
  },
  args: {
    projectId: seededProject.id,
  },
} satisfies Meta<typeof Explore>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Desktop: Story = {
  parameters: {
    viewport: { defaultViewport: "responsive" },
  },
  loaders: [
    async () => {
      await init();
      const fs = openProjectFs(projectStore, seededProject.id);
      for (const [name, layout] of Object.entries(EXAMPLE_SYSTEM_DIAGRAMS)) {
        await writeDiagramLayoutFile(
          fs,
          `${DIAGRAM_LAYOUT_DIR}/${name}`,
          layout,
        );
      }
      return {};
    },
  ],
};

export const Mobile: Story = {
  globals: {
    viewport: { value: "mobile1" },
  },
  parameters: {
    viewport: { defaultViewport: "mobile1" },
  },
  loaders: [
    async () => {
      await init();
      const fs = openProjectFs(projectStore, seededProject.id);
      for (const [name, layout] of Object.entries(EXAMPLE_SYSTEM_DIAGRAMS)) {
        await writeDiagramLayoutFile(
          fs,
          `${DIAGRAM_LAYOUT_DIR}/${name}`,
          layout,
        );
      }
      return {};
    },
  ],
};

export const MobileManyDiagrams: Story = {
  globals: {
    viewport: { value: "mobile1" },
  },
  parameters: {
    viewport: { defaultViewport: "mobile1" },
  },
  args: {
    projectId: manyDiagramsProject.id,
  },
  loaders: [
    async () => {
      await init();
      const fs = openProjectFs(projectStore, manyDiagramsProject.id);
      for (const [name, layout] of Object.entries(manyDiagramsMap)) {
        await writeDiagramLayoutFile(
          fs,
          `${DIAGRAM_LAYOUT_DIR}/${name}`,
          layout,
        );
      }
      return {};
    },
  ],
};

async function seedCrossLevelDiagrams() {
  await init();
  const fs = openProjectFs(projectStore, crossLevelProject.id);
  for (const [name, layout] of Object.entries(CROSS_LEVEL_SYSTEM_DIAGRAMS)) {
    await writeDiagramLayoutFile(
      fs,
      `${DIAGRAM_LAYOUT_DIR}/${name}`,
      layout,
    );
  }
  return {};
}

export const CrossLevelConnections: Story = {
  parameters: {
    viewport: { defaultViewport: "responsive" },
  },
  args: {
    projectId: crossLevelProject.id,
  },
  loaders: [seedCrossLevelDiagrams],
};

export const DrillDownNavigation: Story = {
  args: {
    projectId: crossLevelProject.id,
  },
  loaders: [seedCrossLevelDiagrams],
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
    projectId: crossLevelProject.id,
  },
  loaders: [seedCrossLevelDiagrams],
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
    projectId: crossLevelProject.id,
  },
  loaders: [seedCrossLevelDiagrams],
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
    projectId: seededProject.id,
  },
  loaders: [
    async () => {
      await init();
      const fs = openProjectFs(projectStore, seededProject.id);
      for (const [name, layout] of Object.entries(EXAMPLE_SYSTEM_DIAGRAMS)) {
        await writeDiagramLayoutFile(
          fs,
          `${DIAGRAM_LAYOUT_DIR}/${name}`,
          layout,
        );
      }
      return {};
    },
  ],
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
    projectId: apolloProject?.id ?? seededProject.id,
  },
  loaders: [
    async () => {
      await init();
      if (apolloProject && apolloExample) {
        const fs = openProjectFs(projectStore, apolloProject.id);
        await populateProjectFiles(fs, apolloExample.files);
      }
      return {};
    },
  ],
};

export const SoftwareHouse: Story = {
  parameters: {
    viewport: { defaultViewport: "responsive" },
  },
  args: {
    projectId: softwareHouseProject?.id ?? seededProject.id,
  },
  loaders: [
    async () => {
      await init();
      if (softwareHouseProject && softwareHouseExample) {
        const fs = openProjectFs(projectStore, softwareHouseProject.id);
        await populateProjectFiles(fs, softwareHouseExample.files);
      }
      return {};
    },
  ],
};

export const HoverDocPopup: Story = {
  args: {
    projectId: seededProject.id,
  },
  loaders: [
    async () => {
      await init();
      const fs = openProjectFs(projectStore, seededProject.id);
      for (const [name, layout] of Object.entries(EXAMPLE_SYSTEM_DIAGRAMS)) {
        await writeDiagramLayoutFile(
          fs,
          `${DIAGRAM_LAYOUT_DIR}/${name}`,
          layout,
        );
      }
      return {};
    },
  ],
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
