import type { OnboardingStep } from "../tour/steps";

function page(projectId: string, page: string): string {
  return `/projects/${projectId}/${page}`;
}

/**
 * The quadcopter-drone guided tour: welcome dialog, then one stop per
 * workspace area — navbar, overview, diagrams (canvas + sidebar),
 * inventory, explore — closing in the editor. Best experienced with the
 * bundled drone example open (Projects → New from example → drone).
 */
export function droneTourSteps(projectId: string): OnboardingStep[] {
  return [
    {
      id: "drone-welcome",
      title: "Meet the quadcopter drone 🚁",
      description:
        "This tour walks the drone system through every workspace page. For the full effect, open the bundled drone example first: Projects → New from example → drone.",
      href: page(projectId, "overview"),
    },
    {
      id: "drone-navbar",
      title: "Navbar",
      description:
        "The core navigational component: jump between Editor, Diagrams, Explore, Inventory and System Overview, watch the error/warning counts, and switch warning levels.",
      target: "navbar",
      placement: "bottom",
      href: page(projectId, "overview"),
    },
    {
      id: "drone-overview",
      title: "System Overview",
      description:
        "The model at a glance: component counts, completion score and diagnostics for the whole drone system.",
      target: "overview",
      href: page(projectId, "overview"),
    },
    {
      id: "drone-diagrams-canvas",
      title: "Diagrams: the core tool",
      description:
        "Each view lays the same drone out differently — switch views in the sidebar, then drag nodes, route connections and add notes here, driven from this toolbar.",
      target: "diagramToolbar",
      placement: "top",
      href: page(projectId, "diagrams"),
    },
    {
      id: "drone-diagrams-sidebar",
      title: "Diagrams: selection & inspector",
      description:
        "Pick which components land on the canvas here, and tune the selected node — visuals, text, ports — in the inspector above.",
      target: "diagramSidebar",
      placement: "right",
      href: page(projectId, "diagrams"),
    },
    {
      id: "drone-inventory",
      title: "Inventory",
      description:
        "Browse every component in the drone — definitions, instances, ports and protocols — without opening the canvas.",
      target: "inventory",
      href: page(projectId, "inventory"),
    },
    {
      id: "drone-explore",
      title: "Explore",
      description:
        "Read the component documentation and click through diagrams interactively — each click brings the next diagram.",
      target: "explore",
      href: page(projectId, "explore"),
    },
    {
      id: "drone-editor",
      title: "Editor",
      description:
        "When you need to dive directly into code: the HCL model, live-compiled on every keystroke.",
      target: "editor",
      href: page(projectId, "editor"),
    },
    {
      id: "drone-done",
      title: "Fly safe 🚁",
      description:
        "That is the whole workspace. Replay this tour any time from the Navbar.",
      href: page(projectId, "editor"),
    },
  ];
}
