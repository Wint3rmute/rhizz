import { projectStore } from "./ProjectState.svelte";
import { openProjectFs } from "./vfs/fs";
import {
  DIAGRAM_LAYOUT_DIR,
  writeDiagramLayoutFile,
} from "./routes/projects/[id]/diagrams/persistence";
import type { DiagramLayout } from "./routes/projects/[id]/diagrams/persistence";
import { get_example_projects } from "./rhizz_wasm_wrapper";

// Retrieves the single-file example from the embedded WASM examples (single source of truth).
export function getExampleSystemHcl(): string {
  try {
    const examples = get_example_projects();
    const single = examples.find((e) => e.id === "single-file");
    const first = single?.files[0];
    if (first) {
      return first.content;
    }
  } catch {
    // Fallback if called before WASM initialization
  }
  return "";
}

export const EXAMPLE_SYSTEM_HCL = getExampleSystemHcl();

export const EXAMPLE_SYSTEM_DIAGRAMS: Record<string, DiagramLayout> = {
  "overview.hcl": {
    checked: {
      "home-monitor/sensor": { x: 40, y: 60, width: 150, height: 90 },
      "home-monitor/controller": {
        x: 260,
        y: 40,
        width: 260,
        height: 240,
        textAlign: "top-left",
      },
      "home-monitor/controller/mcu": {
        x: 310,
        y: 95,
        width: 150,
        height: 90,
      },
      "home-monitor/controller/power-supply": {
        x: 300,
        y: 205,
        width: 180,
        height: 90,
      },
      "home-monitor/broker": { x: 620, y: 70, width: 180, height: 100 },
    },
    savedLayout: {
      "home-monitor/sensor": { x: 40, y: 60, width: 150, height: 90 },
      "home-monitor/controller": {
        x: 260,
        y: 40,
        width: 260,
        height: 240,
        textAlign: "top-left",
      },
      "home-monitor/controller/mcu": {
        x: 310,
        y: 95,
        width: 150,
        height: 90,
      },
      "home-monitor/controller/power-supply": {
        x: 300,
        y: 205,
        width: 180,
        height: 90,
      },
      "home-monitor/broker": { x: 620, y: 70, width: 180, height: 100 },
    },
  },
  "cloud-path.hcl": {
    checked: {
      "home-monitor/sensor": {
        x: 57.934548314051284,
        y: 79.99953103377192,
        width: 150,
        height: 90,
      },
      "home-monitor/controller": {
        x: 291.6428741934725,
        y: 40.000579411295234,
        width: 200,
        height: 170,
      },
      "home-monitor/broker": {
        x: 558.2205956219615,
        y: 74.99988157965731,
        width: 180,
        height: 100,
      },
    },
    savedLayout: {
      "home-monitor/sensor": {
        x: 57.934548314051284,
        y: 79.99953103377192,
        width: 150,
        height: 90,
      },
      "home-monitor/controller": {
        x: 291.6428741934725,
        y: 40.000579411295234,
        width: 200,
        height: 170,
      },
      "home-monitor/broker": {
        x: 558.2205956219615,
        y: 74.99988157965731,
        width: 180,
        height: 100,
      },
    },
  },
};

export async function seedExampleProjectDiagrams(
  projectId: string,
): Promise<void> {
  const fs = openProjectFs(projectStore, projectId);
  for (const [name, layout] of Object.entries(EXAMPLE_SYSTEM_DIAGRAMS)) {
    await writeDiagramLayoutFile(fs, `${DIAGRAM_LAYOUT_DIR}/${name}`, layout);
  }
}
