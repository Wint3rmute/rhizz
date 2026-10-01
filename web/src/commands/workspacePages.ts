import { resolve } from "$app/paths";
import { TOUR_TARGETS } from "../tour/tourTargets";

/**
 * The project-scoped workspace pages, in navbar order. One list, imported
 * by the navbar (which renders it) and by the command palette (which
 * offers to jump to it) — the same reason the navbar's own desktop row and
 * mobile menu share a list: two copies of "where can I go" is two chances
 * to forget a page.
 *
 * `href` is a thunk so `resolve` still sees a literal route id (typed
 * routes), which it cannot do if the resolved string is stored instead.
 */
export type WorkspacePageId =
  | "overview"
  | "modeling"
  | "inventory"
  | "explore"
  | "code";

export interface WorkspacePage {
  id: WorkspacePageId;
  label: string;
  icon: string;
  /** The guided tour's anchor for this page, for the navbar's spotlight. */
  tour: string;
  href: (projectId: string) => string;
}

export const WORKSPACE_PAGES: readonly WorkspacePage[] = [
  {
    id: "overview",
    label: "Overview",
    icon: "🔍",
    tour: TOUR_TARGETS.navOverview,
    href: (id: string) => resolve("/projects/[id]/overview", { id }),
  },
  {
    id: "modeling",
    label: "Modeling",
    icon: "📐",
    tour: TOUR_TARGETS.navModeling,
    // Modeling and Inventory name the open view / entity in their path (a
    // rest param that also matches the empty string), so the links point at
    // the bare page and let each view canonicalise itself to its first view
    // / entity on arrival.
    href: (id: string) =>
      resolve("/projects/[id]/modeling/[...view]", { id, view: "" }),
  },
  {
    id: "inventory",
    label: "Inventory",
    icon: "📦",
    tour: TOUR_TARGETS.navInventory,
    href: (id: string) =>
      resolve("/projects/[id]/inventory/[...label]", { id, label: "" }),
  },
  {
    id: "explore",
    label: "Explore",
    icon: "🧭",
    tour: TOUR_TARGETS.navExplore,
    href: (id: string) => resolve("/projects/[id]/explore", { id }),
  },
  {
    id: "code",
    label: "Code",
    icon: "📝",
    tour: TOUR_TARGETS.navCode,
    href: (id: string) => resolve("/projects/[id]/code", { id }),
  },
];
