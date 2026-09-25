import type { Meta, StoryObj } from "@storybook/svelte";
import { expect, userEvent, within } from "storybook/test";
import init from "rhizz";
import type { Project } from "../../../../vfs/types";
import {
  createProjectWithMainFile,
  projectStore,
} from "../../../../ProjectState.svelte";
import {
  EXAMPLE_SYSTEM_DIAGRAMS,
  EXAMPLE_SYSTEM_HCL,
} from "../../../../example_system";
import { openProjectFs } from "../../../../vfs/fs";
import {
  type DiagramLayout,
  VIEW_LAYOUT_DIR,
  writeDiagramLayoutFile,
} from "../modeling/persistence";
import Explore from "./Explore.svelte";

// Deterministic project ids so story args can be built synchronously at
// module scope while async seeding runs from loaders (top-level await in
// story files races the vitest-addon's test registration).
const SEEDED_PROJECT_ID = "story-explore-viewer";
const MANY_DIAGRAMS_PROJECT_ID = "story-explore-many-diagrams";
const CROSS_LEVEL_PROJECT_ID = "story-explore-cross-level";

const sampleOverview = EXAMPLE_SYSTEM_DIAGRAMS["overview.hcl"];
const sampleCloud = EXAMPLE_SYSTEM_DIAGRAMS["cloud-path.hcl"];

const EMPTY_LAYOUT: DiagramLayout = {
  checked: {},
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
  full_name = "DC power delivery"
  roles       = ["provider", "consumer"]
}

protocol "spi" {
  full_name = "Serial peripheral interface"
  roles       = ["provider", "consumer"]
}

component "battery" {
  full_name = "Main power source"
  leaf        = true

  port "power-out" {
    protocol = "power"
    role     = "provider"
    external = true
  }
}

component "controller" {
  full_name = "Processing hub with internal MCU"
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
  full_name = "Microcontroller unit"
  leaf        = true

  port "spi" {
    protocol = "spi"
    role     = "provider"
    external = true
  }
}

component "sensor" {
  full_name = "External IMU sensor"
  leaf        = true

  port "spi" {
    protocol = "spi"
    role     = "consumer"
    external = true
  }
}

system "demo-system" {
  full_name = "System with sibling and non-sibling cross-level connections"

  instance "battery" {
    source = "battery"
  }

  instance "controller" {
    source = "controller"
  }

  instance "sensor" {
    source = "sensor"
  }

  connection "power-link" {
    full_name = "Power delivery"
    from        = "battery/power-out"
    to          = "controller/power-in"
  }

  connection "sensor-bus" {
    full_name = "Cross-level SPI bus"
    from        = "controller/mcu/spi"
    to          = "sensor/spi"
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
  },
};

async function ensureProjectWithDiagrams(
  id: string,
  name: string,
  diagrams: Record<string, DiagramLayout>,
  hclContent: string = EXAMPLE_SYSTEM_HCL,
): Promise<Project> {
  await init();
  const existing = await projectStore.listProjects();
  const project = existing.find((p) => p.id === id) ??
    await createProjectWithMainFile(name, hclContent, id);
  const fs = openProjectFs(projectStore, project.id);
  for (const [dName, layout] of Object.entries(diagrams)) {
    await writeDiagramLayoutFile(fs, `${VIEW_LAYOUT_DIR}/${dName}`, layout);
  }
  return project;
}

async function ensureSeededProject(): Promise<Project> {
  return ensureProjectWithDiagrams(
    SEEDED_PROJECT_ID,
    "Viewer story",
    EXAMPLE_SYSTEM_DIAGRAMS,
  );
}

async function ensureManyDiagramsProject(): Promise<Project> {
  return ensureProjectWithDiagrams(
    MANY_DIAGRAMS_PROJECT_ID,
    "Many diagrams story",
    manyDiagramsMap,
  );
}

async function ensureCrossLevelProject(): Promise<Project> {
  const project = await ensureProjectWithDiagrams(
    CROSS_LEVEL_PROJECT_ID,
    "Cross level connections story",
    CROSS_LEVEL_SYSTEM_DIAGRAMS,
    CROSS_LEVEL_SYSTEM_HCL,
  );
  // Seeded doc for battery (whose full_name is "Main power source").
  const fs = openProjectFs(projectStore, project.id);
  await fs.mkdir("docs", { recursive: true });
  await fs.writeFile("docs/battery.md", "Stores charge.\n");
  return project;
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

export const HoverDocHeader: Story = {
  parameters: {
    viewport: { defaultViewport: "responsive" },
  },
  args: {
    projectId: CROSS_LEVEL_PROJECT_ID,
  },
  loaders: [ensureCrossLevelProject],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Hovering the battery node shows its doc tooltip headed by the
    // component's full_name as an L1 header (read-only — no save here).
    // Hover the node's <a> anchor: the SVG label itself is
    // pointer-events-none, so userEvent refuses to target it directly.
    const anchor = canvas.getByText("battery").closest("a");
    if (!anchor) throw new Error("battery node has no hover anchor");
    await userEvent.hover(anchor);
    const tooltip = await canvas.findByTestId("explore-doc-tooltip");
    const tooltipQueries = within(tooltip);
    await expect(
      tooltipQueries.getByRole("heading", {
        name: "Main power source",
      }),
    ).toBeTruthy();
    await expect(tooltipQueries.getByText("Stores charge.")).toBeTruthy();
  },
};
