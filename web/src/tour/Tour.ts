import type { OnboardingStep } from "./steps";

function page(projectId: string, page: string): string {
  return `/projects/${projectId}/${page}`;
}

/**
 * The workspace guided tour: welcome dialog, a navbar intro, then per page
 * a preview stop (spotlighting the page's navbar button while staying put)
 * followed by the page itself — modeling gets two (toolbar + sidebar) —
 * closing in code. It talks about elements of every Rhizz project
 * (systems, components, views, diagnostics), never about one example.
 */
export function tourSteps(projectId: string): OnboardingStep[] {
  return [
    {
      id: "tour-welcome",
      title: "Welcome to Rhizz 👋",
      description: `This tour walks a project through every workspace page —
        navigation, overview, modeling, inventory, explore and code. With no
        project open, the tour button opens your first project, or creates an
        example when the list is empty.`,
      href: page(projectId, "overview"),
    },
    {
      id: "tour-navbar",
      title: "Navbar",
      description: `The core navigational component: jump between Overview,
        Modeling, Inventory, Explore and Code, watch the
        error/warning counts, and switch warning levels.`,
      target: "navbar",
      placement: "bottom",
      href: page(projectId, "overview"),
    },
    {
      id: "tour-overview-preview",
      title: "Up next: Overview",
      description: `First, let's open the Overview page — component counts,
        completion score and diagnostics for the whole system, all in one
        place.`,
      target: "navOverview",
      placement: "bottom",
      href: page(projectId, "overview"),
    },
    {
      id: "tour-overview",
      title: "Overview",
      description: `The model at a glance: component counts, completion score
        and diagnostics for the whole system.`,
      target: "overview",
      href: page(projectId, "overview"),
    },
    {
      id: "tour-modeling-preview",
      title: "Up next: Modeling",
      description: `Next up is Modeling, the core tool — drag nodes, route
        connections and add notes on the canvas.`,
      target: "navModeling",
      placement: "bottom",
      href: page(projectId, "overview"),
    },
    {
      id: "tour-diagrams-canvas",
      title: "Modeling: the core tool",
      description: `Each view lays the same system out differently — switch
        views in the sidebar, then drag nodes, route connections and add notes
        here, driven from this toolbar.`,
      target: "diagramToolbar",
      placement: "top",
      href: page(projectId, "modeling"),
    },
    {
      id: "tour-diagrams-sidebar",
      title: "Modeling: selection & inspector",
      description: `Pick which components land on the canvas here, and tune
        the selected node — visuals, text, ports — in the inspector above.`,
      target: "diagramSidebar",
      placement: "right",
      href: page(projectId, "modeling"),
    },
    {
      id: "tour-inventory-preview",
      title: "Up next: Inventory",
      description: `The Inventory page lists every component — definitions,
        instances, ports and protocols — without opening the canvas.`,
      target: "navInventory",
      placement: "bottom",
      href: page(projectId, "modeling"),
    },
    {
      id: "tour-inventory",
      title: "Inventory",
      description: `Browse every component — definitions, instances, ports and
        protocols — without opening the canvas.`,
      target: "inventory",
      href: page(projectId, "inventory"),
    },
    {
      id: "tour-explore-preview",
      title: "Up next: Explore",
      description: `Explore is for reading component documentation and
        clicking through diagrams interactively.`,
      target: "navExplore",
      placement: "bottom",
      href: page(projectId, "inventory"),
    },
    {
      id: "tour-explore",
      title: "Explore",
      description: `Read the component documentation and click through
        diagrams interactively — each click brings the next diagram.`,
      target: "explore",
      placement: "right",
      href: page(projectId, "explore"),
    },
    {
      id: "tour-editor-preview",
      title: "Up next: Code",
      description: `And Code is the HCL model itself, live-compiled on every
        keystroke.`,
      target: "navCode",
      placement: "bottom",
      href: page(projectId, "explore"),
    },
    {
      id: "tour-editor",
      title: "Code",
      description: `When you need to dive directly into code: the HCL model,
        live-compiled on every keystroke.`,
      target: "editor",
      href: page(projectId, "code"),
    },
    {
      id: "tour-done",
      title: "You're set 🚀",
      description: `That is the whole workspace. Replay this tour any time
        from the Navbar.`,
      href: page(projectId, "code"),
    },
  ];
}
