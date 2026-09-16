import type { Meta, StoryObj } from "@storybook/svelte";
import { expect, fireEvent, userEvent, waitFor, within } from "storybook/test";
import type { ProjectJS } from "rhizz";
import {
  createProjectWithMainFile,
  projectStore,
} from "../ProjectState.svelte";
import { getSelection, setSelection } from "../ThemeState.svelte";
import { getWarningLevel, setWarningLevel } from "../WarningLevelState.svelte";
import type { ThemeSelection } from "../theme";
import type { WarningLevel } from "../rhizz_wasm_wrapper";
import Navbar from "./Navbar.svelte";

type StoryProject = Pick<ProjectJS, "name" | "version" | "authors">;

const sampleProject = {
  name: "BuzzVid",
  version: "1.0.0",
  authors: ["Ada Lovelace"],
} satisfies StoryProject;

// Deterministic project id so seeding can stay lazy (and out of module
// scope — top-level await in story files races the vitest-addon's test
// registration; see Explore.stories.ts), while staying idempotent across
// module re-evaluations.
const NAVBAR_PROJECT_ID = "story-navbar";

// The Navbar's story fixtures don't render store data (args supply a
// static sample project), but a matching project still needs to exist for
// project-scoped store/links; created lazily before each story renders.
async function ensureNavbarProject(): Promise<void> {
  const existing = await projectStore.listProjects();
  const match = existing.find((p) => p.id === NAVBAR_PROJECT_ID);
  if (match) return;
  await createProjectWithMainFile(
    "Navbar Story Project",
    `project { name = "Navbar Story Project" }`,
    NAVBAR_PROJECT_ID,
  );
}

const meta = {
  title: "Components/Navbar",
  component: Navbar,
  parameters: {
    layout: "fullscreen",
  },
  args: {
    project: sampleProject as ProjectJS,
    errorCount: 2,
    warningCount: 1,
  },
  beforeEach: [ensureNavbarProject],
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
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const select = canvas.getByRole<HTMLSelectElement>("combobox", {
      name: "Warning level",
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
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const select = await canvas.findByRole<HTMLSelectElement>("combobox", {
      name: "Warning level",
    });
    await expect(select.value).toBe("architectural");
    await expect(
      Array.from(select.options).map((option) => option.text),
    ).toEqual(["Business", "Architectural", "Component"]);

    await userEvent.selectOptions(select, "component");
    await expect(getWarningLevel()).toBe("component");
  },
};
