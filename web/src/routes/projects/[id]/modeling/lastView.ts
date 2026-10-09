// The last view opened in Modeling, per project — the answer to "which
// diagram?" when the user arrives at the bare `/modeling` page (navbar link,
// "Go to Modeling" palette row) instead of a view's own URL.
//
// localStorage, not the VFS: this is a per-browser UI preference, not project
// content — it must never land in versioned `views/*.hcl`. Same storage idiom
// as tourRequest / WarningLevelState: a namespaced key, JSON-encoded value,
// guarded access (SSR / private-browsing have no working storage), and a
// validated read so garbage never reaches the router.

/** localStorage key prefix; the project id is appended per project. */
const LAST_VIEW_KEY_PREFIX = "rhizz-last-view:";

function storageKey(projectId: string): string {
  return `${LAST_VIEW_KEY_PREFIX}${projectId}`;
}

function viewStore():
  | Pick<
    Storage,
    "getItem" | "setItem" | "removeItem"
  >
  | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    // Private browsing etc. — remembering simply does not happen.
    return null;
  }
}

/**
 * Records the view the user settled on. Called on every view change that
 * lands in the URL (selectView's `path`), so the next bare-page arrival can
 * reopen it.
 */
export function rememberLastView(projectId: string, viewPath: string): void {
  try {
    viewStore()?.setItem(storageKey(projectId), JSON.stringify(viewPath));
  } catch {
    // Storage unwritable: the bare page just falls back to the first view.
  }
}

/**
 * The remembered view for this project, or `null` when nothing usable was
 * stored (never visited, corrupt entry, wrong type).
 */
export function readLastView(projectId: string): string | null {
  try {
    const raw = viewStore()?.getItem(storageKey(projectId)) ?? null;
    if (raw === null) return null;
    const decoded: unknown = JSON.parse(raw);
    return typeof decoded === "string" && decoded !== "" ? decoded : null;
  } catch {
    return null;
  }
}

/**
 * Drops the remembered view — test seam for hermetic stories, and the right
 * call when a project is recreated from scratch under a reused id.
 */
export function forgetLastView(projectId: string): void {
  try {
    viewStore()?.removeItem(storageKey(projectId));
  } catch {
    // Storage unwritable: nothing to forget.
  }
}

export interface ViewChoice {
  /** The view the URL names ("" = bare page, no request). */
  requested: string;
  /** The per-project remembered view (`null` = none usable). */
  remembered: string | null;
  /** The view currently open in the page (`null` = none yet). */
  open: string | null;
  /** The first view in the project (`null` = no views at all). */
  first: string | null;
  /** Whether a view path still names an existing view file. */
  exists: (viewPath: string) => boolean;
}

/**
 * Which view a bare-or-navigated `/modeling` arrival should open. Priority:
 * an explicit request (deep link, legacy `?diagram=`, back/forward) always
 * wins; then the remembered view when it still exists; then whatever is
 * already open; then the first view; `null` when the project has no views.
 */
export function resolveViewToOpen(choice: ViewChoice): string | null {
  if (choice.requested !== "") return choice.requested;
  if (choice.remembered !== null && choice.exists(choice.remembered)) {
    return choice.remembered;
  }
  return choice.open ?? choice.first;
}
