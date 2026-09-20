import type { Meta, StoryObj } from "@storybook/svelte";
import { expect, fireEvent, userEvent, waitFor, within } from "storybook/test";
import {
  clearCurrentProject,
  createProjectWithMainFile,
  projectStore,
  setCurrentProject,
  setCurrentScore,
} from "../ProjectState.svelte";
import { getSelection, setSelection } from "../ThemeState.svelte";
import { getWarningLevel, setWarningLevel } from "../WarningLevelState.svelte";
import type { ThemeSelection } from "../theme";
import type { WarningLevel } from "../rhizz_wasm_wrapper";
import Navbar from "./Navbar.svelte";

// Deterministic project id so seeding can stay lazy (and out of module
// scope — top-level await in story files races the vitest-addon's test
// registration; see Explore.stories.ts), while staying idempotent across
// module re-evaluations.
const NAVBAR_PROJECT_ID = "story-navbar";

// The Navbar reads everything from the shared ProjectState singleton (the app
// renders `<Navbar />` with no props), so the stories drive that singleton
// rather than injecting fixtures through props: seed the project, make it the
// active one, and publish the score the badge renders.
async function ensureNavbarProject(): Promise<void> {
  const existing = await projectStore.listProjects();
  if (!existing.some((p) => p.id === NAVBAR_PROJECT_ID)) {
    await createProjectWithMainFile(
      "Navbar Story Project",
      `project { name = "Navbar Story Project" }`,
      NAVBAR_PROJECT_ID,
    );
  }
  await setCurrentProject(NAVBAR_PROJECT_ID);
  setCurrentScore({ overall_percentage: 72.5 });
}

// Leaves no story pinned to the fixture project (or its badges).
function clearNavbarProject(): void {
  clearCurrentProject();
}

const meta = {
  title: "Components/Navbar",
  component: Navbar,
  parameters: {
    layout: "fullscreen",
  },
  beforeEach: [ensureNavbarProject],
  afterEach: [clearNavbarProject],
} satisfies Meta<typeof Navbar>;

export default meta;

type Story = StoryObj<typeof meta>;

// The theme selection lives in a module-level singleton (ThemeState) that
// is shared across all stories and persists to localStorage, so stories
// that need a specific selection must pin it before rendering and restore
// it afterwards — otherwise the choice would leak into every other story's
// screenshots.
let savedSelection: ThemeSelection = getSelection();

export const Desktop: Story = {
  parameters: {
    viewport: { defaultViewport: "responsive" },
  },
};

export const MobileCollapsed: Story = {
  globals: {
    viewport: { value: "mobile1" },
  },
  parameters: {
    viewport: { defaultViewport: "mobile1" },
  },
  args: {
    isOpen: false,
  },
};

export const MobileExpanded: Story = {
  globals: {
    viewport: { value: "mobile1" },
  },
  parameters: {
    viewport: { defaultViewport: "mobile1" },
  },
  args: {
    isOpen: true,
  },
};

// Workspace link order: brand, then Overview → Diagrams → Inventory →
// Explore → Editor. Asserted on the mobile menu (the desktop row is hidden
// below the md breakpoint, but one NAV_LINKS list drives both, so they
// cannot drift). The brand link comes first in DOM order.
export const LinkOrder: Story = {
  ...MobileExpanded,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const names = canvas.getAllByRole("link").map((link) =>
      link.textContent.trim()
    );
    await expect(names).toEqual([
      "Rhizz",
      "🔍 Overview",
      "📐 Modeling",
      "📦 Inventory",
      "🧭 Explore",
      "📝 Code",
    ]);
  },
};

export const MobileThemePicker = {
  ...MobileExpanded,
  beforeEach: () => {
    savedSelection = getSelection();
    // Pin a concrete value so the picker shows the 🌙 Dark option
    // selected; the tri-state row is the functionality under test.
    setSelection("dark");
  },
  afterEach: () => {
    setSelection(savedSelection);
    clearNavbarProject();
  },
} satisfies Story;

// The warning level lives in a module-level singleton (WarningLevelState)
// shared across all stories and persisted to localStorage, so this story pins
// a known value before rendering and restores it afterwards — otherwise the
// choice would leak into every other story's screenshots.
let savedWarningLevel: WarningLevel = getWarningLevel();

// The desktop control lives in the navbar's `hidden md:flex` cluster, and the
// storybook test runner's viewport sits below Tailwind's `md` breakpoint, so
// `display: none` applies and the control is dropped from the accessibility
// tree. `hidden: true` keeps the query — and its accessible-name check —
// working in either viewport, and `fireEvent` (unlike `userEvent`) drives a
// control that is not on screen. Only one combobox exists here: the mobile
// copy renders behind `{#if isOpen}`, which defaults to false.
export const WarningLevelSelector: Story = {
  beforeEach: async () => {
    await ensureNavbarProject();
    savedWarningLevel = getWarningLevel();
    setWarningLevel("component");
  },
  afterEach: () => {
    setWarningLevel(savedWarningLevel);
    clearNavbarProject();
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const select = canvas.getByRole<HTMLSelectElement>("combobox", {
      name: "Strictness",
      hidden: true,
    });

    // The select reflects the persisted setting...
    await expect(select.value).toBe("component");
    await expect(
      Array.from(select.options).map((option) => option.value),
    ).toEqual(["business", "architectural", "component"]);
    // ...rendering capitalised labels while the values stay lowercase, matching
    // the compiler's vocabulary.
    await expect(
      Array.from(select.options).map((option) => option.text),
    ).toEqual(["Business", "Architectural", "Component"]);

    // ...and changing it writes back to the shared setting, which re-renders
    // the select (Svelte flushes reactivity asynchronously).
    await fireEvent.change(select, { target: { value: "business" } });
    await waitFor(() => expect(getWarningLevel()).toBe("business"));
    await waitFor(() => expect(select.value).toBe("business"));
  },
};

// The mobile menu carries its own copy of the selector (the desktop one is
// hidden below the md breakpoint), so it needs its own coverage.
export const MobileWarningLevelSelector: Story = {
  ...MobileExpanded,
  beforeEach: async () => {
    await ensureNavbarProject();
    savedWarningLevel = getWarningLevel();
    setWarningLevel("architectural");
  },
  afterEach: () => {
    setWarningLevel(savedWarningLevel);
    clearNavbarProject();
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const select = await canvas.findByRole<HTMLSelectElement>("combobox", {
      name: "Strictness",
    });
    await expect(select.value).toBe("architectural");
    await expect(
      Array.from(select.options).map((option) => option.text),
    ).toEqual(["Business", "Architectural", "Component"]);

    await userEvent.selectOptions(select, "component");
    await expect(getWarningLevel()).toBe("component");
  },
};
