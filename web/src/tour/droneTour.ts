import type { OnboardingStep } from "../tour/steps";

function page(projectId: string, page: string): string {
  return `/projects/${projectId}/${page}`;
}

/**
 * The workspace guided tour: welcome dialog, then one stop per area —
 * navbar, overview, diagrams (toolbar + sidebar), inventory, explore —
 * closing in the editor. It talks about elements of every Rhizz project
 * (systems, components, views, diagnostics), never about one example.
 */
export function droneTourSteps(projectId: string): OnboardingStep[] {
  return [
    {
      id: "drone-welcome",
      title: "Welcome to Rhizz 👋",
      description:
        "This tour walks a project through every workspace page — navigation, overview, diagrams, inventory, explore and code. With no project open, the tour button opens your first project, or creates an example when the list is empty.",
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
        "The model at a glance: component counts, completion score and diagnostics for the whole system.",
      target: "overview",
      href: page(projectId, "overview"),
    },
    {
      id: "drone-diagrams-canvas",
      title: "Diagrams: the core tool",
      description:
        "Each view lays the same system out differently — switch views in the sidebar, then drag nodes, route connections and add notes here, driven from this toolbar.",
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
        "Browse every component — definitions, instances, ports and protocols — without opening the canvas.",
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
      title: "You're set 🚀",
      description:
        "That is the whole workspace. Replay this tour any time from the Navbar.",
      href: page(projectId, "editor"),
    },
  ];
}
