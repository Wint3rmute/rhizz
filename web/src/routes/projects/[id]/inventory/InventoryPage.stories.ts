import type { Meta, StoryObj } from "@storybook/svelte";
import { expect, userEvent, waitFor, within } from "storybook/test";
import init from "rhizz";
import type { Project } from "../../../../vfs/types";
import { projectSlug } from "../../../../vfs/slug";
import {
  createProjectWithFiles,
  projectStore,
} from "../../../../ProjectState.svelte";
import { openProjectFs } from "../../../../vfs/fs";
import {
  type DiagramLayout,
  VIEW_LAYOUT_DIR,
  writeDiagramLayoutFile,
} from "../modeling/persistence";
import Inventory from "./Inventory.svelte";

// Deterministic project ids so story args can be built synchronously at
// module scope while the async seeding runs lazily from loaders (top-level
// await in story files races the vitest-addon's test registration — see
// Explore.stories.ts).
const SEEDED_PROJECT_NAME = "Inventory story";
// A project's id is the slug of its name (see vfs/slug), so a story derives
// its fixture id the same way the app does — synchronously, because the meta
// args below need it at module scope.
const SEEDED_PROJECT_ID = projectSlug(SEEDED_PROJECT_NAME);
const EMPTY_PROJECT_NAME = "Inventory empty story";
// A project's id is the slug of its name (see vfs/slug), so a story derives
// its fixture id the same way the app does — synchronously, because the meta
// args below need it at module scope.
const EMPTY_PROJECT_ID = projectSlug(EMPTY_PROJECT_NAME);

// A small definitions-first model: three top-level definitions with mixed
// completion, plus a system that instantiates two of them.
const INVENTORY_HCL = `project {
  name    = "inventory-demo"
  version = "0.1.0"
}

protocol "power" {
  full_name = "DC power delivery"
  roles       = ["provider", "consumer"]

  message "voltage" {
    full_name = "Current voltage reading"
    field "volts" {
      type = "float32"
      unit = "V"
    }
  }
}

component "battery" {
  full_name = "Main power source with a full name"
  leaf        = true

  port "power-out" {
    protocol = "power"
    role     = "provider"
  }
}

component "controller" {
  full_name = "Processing hub"
  leaf        = false

  instance "mcu" {
    source = "mcu"
  }
}

component "mcu" {
  leaf = true

  port "spi" {
    protocol = "power"
    role     = "provider"
  }
}

component "draft-module" {
  leaf = false
}

// Deliberately unstyled: the Style tab story styles it, and a fixture that
// arrived pre-styled could not tell a write that landed from one that was
// always there.
component "styled-module" {
  full_name = "Module that gets styled from the Style tab"
  leaf        = true

  port "bus" {
    protocol = "power"
    role     = "consumer"
  }
}

system "demo-system" {
  full_name = "System using two of the definitions"

  instance "battery" {
    source = "battery"
  }

  instance "controller" {
    source = "controller"
  }

  connection "power-link" {
    from = "battery/power-out"
    to   = "controller/mcu/spi"
  }
}

system "aux-system" {
}
`;

// Default view diagrams for two of the three definitions — "draft-module"
// intentionally has none, so it shows the empty state.
const DEFINITION_DIAGRAMS: Record<string, DiagramLayout> = {
  "battery.hcl": {
    checked: {
      "demo-system/battery": { x: 60, y: 60, width: 160, height: 100 },
    },
  },
  "controller.hcl": {
    checked: {
      "demo-system/controller": {
        x: 40,
        y: 40,
        width: 260,
        height: 220,
        textAlign: "top-left",
      },
      "demo-system/controller/mcu": { x: 80, y: 110, width: 170, height: 100 },
    },
  },
};

async function ensureInventoryProject(): Promise<Project> {
  await init();
  const existing = await projectStore.listProjects();
  const project = existing.find((p) => p.id === SEEDED_PROJECT_ID) ??
    await createProjectWithFiles(
      SEEDED_PROJECT_NAME,
      [{ path: "main.hcl", content: INVENTORY_HCL }],
    );
  const fs = openProjectFs(projectStore, project.id);
  for (const [dName, layout] of Object.entries(DEFINITION_DIAGRAMS)) {
    await writeDiagramLayoutFile(fs, `${VIEW_LAYOUT_DIR}/${dName}`, layout);
  }
  // The demo-system view, bound to the system itself — the same convention
  // a system selection previews (`views/<system>.hcl`). aux-system
  // deliberately has none, so it shows the system empty state.
  await writeDiagramLayoutFile(
    fs,
    `${VIEW_LAYOUT_DIR}/demo-system.hcl`,
    {
      checked: {
        "demo-system/battery": { x: 60, y: 60, width: 160, height: 100 },
        "demo-system/controller": {
          x: 260,
          y: 60,
          width: 200,
          height: 140,
        },
      },
    },
    "demo-system",
  );
  // Seeded documentation for battery (controller/mcu/draft-module have none).
  await fs.mkdir("docs", { recursive: true });
  await fs.writeFile("docs/battery.md", "# Battery\n\nMain power source.\n");
  return project;
}

// An empty project: no definitions at all.
async function ensureEmptyProject(): Promise<Project> {
  const existing = await projectStore.listProjects();
  return existing.find((p) => p.id === EMPTY_PROJECT_ID) ??
    await createProjectWithFiles(
      EMPTY_PROJECT_NAME,
      [{ path: "main.hcl", content: 'project {\n  name    = "empty"\n}\n' }],
    );
}

const meta = {
  title: "Pages/Inventory",
  component: Inventory,
  parameters: {
    layout: "fullscreen",
  },
  args: {
    projectId: SEEDED_PROJECT_ID,
  },
} satisfies Meta<typeof Inventory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Desktop: Story = {
  parameters: {
    viewport: { defaultViewport: "responsive" },
  },
  loaders: [ensureInventoryProject],
};

export const SystemsTab: Story = {
  loaders: [ensureInventoryProject],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("tab", { name: "Systems" }),
    );
    // Both fixture systems are listed, each without the L1 level badge —
    // systems are not leveled, so the card hides it.
    const cards = await canvas.findAllByTestId("inventory-card");
    await expect(cards).toHaveLength(2);
    for (const card of cards) {
      await expect(card.textContent).not.toContain("L1");
    }
    await expect(canvas.getByText("demo-system")).toBeTruthy();
    await expect(canvas.getByText("aux-system")).toBeTruthy();
    // The add button follows the tab: systems here, components there.
    await expect(
      canvas.getByRole("button", { name: "+ New System" }),
    ).toBeTruthy();
  },
};

// The add button opens the shared creation modal locked to new
// definitions: no "Use Existing Component" toggle, since this page never
// places instances.
export const AddComponentOpensDefinitionModal: Story = {
  loaders: [ensureInventoryProject],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "+ New Component" }),
    );
    const modal = within(
      await canvas.findByTestId("create-component-modal"),
    );
    await expect(modal.getByText("Create New Component")).toBeTruthy();
    await expect(
      modal.queryByRole("button", { name: "Use Existing Component" }),
    ).not.toBeInTheDocument();
    await expect(
      modal.getByRole("button", { name: "Create Definition" }),
    ).toBeTruthy();
  },
};
// The system button opens a name-only creation modal in the same style.
export const AddSystemOpensCreationModal: Story = {
  loaders: [ensureInventoryProject],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("tab", { name: "Systems" }),
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "+ New System" }),
    );
    const modal = within(
      await canvas.findByTestId("create-system-modal"),
    );
    await expect(modal.getByText("Create New System")).toBeTruthy();
    await expect(
      modal.getByRole("button", { name: "Create System" }),
    ).toBeTruthy();
  },
};
// A system with a same-named view previews it, like a definition does.
// `demo-system.hcl` is seeded bound to demo-system itself.
export const SystemDiagramPreview: Story = {
  args: { requestedLabel: "demo-system" },
  loaders: [ensureInventoryProject],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // The deep link lands on the system: the Systems tab holds the open
    // row, and the preview is a diagram rather than the empty state.
    const tab = canvas.getByRole("tab", { name: "Systems" });
    await expect(tab.getAttribute("aria-selected")).toBe("true");
    await canvas.findByTestId("inventory-diagram");
    await expect(
      canvas.queryByTestId("inventory-empty-diagram"),
    ).not.toBeInTheDocument();
  },
};

// A system without a same-named view gets the empty state with the
// system-worded button. `aux-system` deliberately has no view file.
export const SystemMissingDiagram: Story = {
  args: { requestedLabel: "aux-system" },
  loaders: [ensureInventoryProject],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByTestId("inventory-empty-diagram"),
    ).toBeTruthy();
    await expect(
      canvas.getByText(/views\/aux-system\.hcl/),
    ).toBeTruthy();
    await expect(
      canvas.getByTestId("inventory-create-view"),
    ).toBeTruthy();
    await expect(
      canvas.getByRole("button", { name: "Create a view for this system" }),
    ).toBeTruthy();
  },
};
export const MissingDefaultDiagram: Story = {
  loaders: [ensureInventoryProject],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const card = canvas.getByText("draft-module");
    await userEvent.click(card);
    await expect(
      canvas.getByTestId("inventory-empty-diagram"),
    ).toBeTruthy();
    await expect(
      canvas.getByText(/views\/draft-module\.hcl/),
    ).toBeTruthy();
    await expect(
      canvas.getByTestId("inventory-create-view"),
    ).toBeTruthy();
    await expect(
      canvas.getByRole("button", { name: "Create a view for this component" }),
    ).toBeTruthy();
  },
};

// Clicking a node in the preview focuses the inventory on that component —
// the same thing clicking its card does, which is why it also moves the URL
// and why back/forward work (e2e covers that half; a story has no address bar).
//
// The fixture's `controller` preview places the `mcu` instance inside it, and
// `mcu` is a definition of its own, so the click has somewhere to land. That
// instance is named after the definition it was sourced from, so here the node
// label and the focused label are the same string; the case where they differ
// is unit-tested on definitionLabelForNode, which is cheaper than churning
// every diagram baseline in this file to rename it.
export const ClickingANodeFocusesThatComponent: Story = {
  args: { requestedLabel: "controller" },
  loaders: [ensureInventoryProject],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const diagram = canvas.getByTestId("inventory-diagram");
    // The node is a link now, and announces what it does here rather than the
    // canvas's default "open detailed view" wording, which would be a lie on
    // this page.
    const node = await within(diagram).findByRole("link", {
      name: "mcu, open in inventory",
    });
    await userEvent.click(node);
    // Focused: `mcu` has no diagram of its own, so the preview is now the
    // empty state offering to create one — the same state its card would give.
    await expect(canvas.getByTestId("inventory-empty-diagram")).toBeTruthy();
    await expect(canvas.getByText(/views\/mcu\.hcl/)).toBeTruthy();
  },
};

// Presses "Edit" and waits for Monaco to exist. Its *content* is asserted in
// e2e: this browser is ~414px wide, where the editor box collapses to zero and
// Monaco paints nothing, so a content assertion here would pass vacuously.
async function openDocEditor(canvas: ReturnType<typeof within>) {
  await userEvent.click(await canvas.findByTestId("inventory-doc-edit-button"));
  const host = canvas.getByTestId("inventory-doc-editor");
  // Monaco's input, by the aria label it gives itself (the default of its
  // `ariaLabel` option) — this version also keeps a hidden IME textarea.
  await waitFor(() => {
    void expect(host.querySelector('[aria-label="Editor content"]'))
      .toBeTruthy();
  });
}

export const DocumentationTab: Story = {
  loaders: [ensureInventoryProject],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // battery is selected by default; its seeded docs/battery.md renders
    // as Markdown in the Description tab (read-only here — e2e covers save).
    await canvas.findByTestId("inventory-doc-viewer");
    await expect(
      canvas.getByRole("heading", { name: "Battery" }),
    ).toBeTruthy();

    // "Edit" swaps the rendered doc for the app's editor — the same Monaco
    // component the Code page uses for these very files.
    await openDocEditor(canvas);
    await userEvent.click(canvas.getByTestId("inventory-doc-cancel-button"));
    await expect(
      canvas.getByRole("heading", { name: "Battery" }),
    ).toBeTruthy();
  },
};

export const EmptyModel: Story = {
  args: {
    projectId: EMPTY_PROJECT_ID,
  },
  loaders: [ensureEmptyProject],
};

// A shared link to an entity opens exactly that entity. The requested one is
// deliberately not the first card, so this can't pass by accident on the same
// entity a bare /inventory would have opened.
export const DeepLinkedEntity: Story = {
  args: {
    requestedLabel: "draft-module",
  },
  loaders: [ensureInventoryProject],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const cards = await canvas.findAllByTestId("inventory-card");
    const pressed = cards.filter((card) =>
      card.getAttribute("aria-pressed") === "true"
    );
    await expect(pressed).toHaveLength(1);
    await expect(pressed[0]).toHaveTextContent("draft-module");
    // "battery" is the first definition — what a bare /inventory opens.
    const batteryIsOpen = cards.some(
      (card) =>
        card.getAttribute("aria-pressed") === "true" &&
        card.textContent.includes("battery"),
    );
    await expect(batteryIsOpen).toBe(false);
    // ...and the detail pane follows: draft-module is the definition without a
    // default view, so its preview shows the empty state.
    await expect(canvas.getByTestId("inventory-empty-diagram")).toBeTruthy();
  },
};

// The detail pane is a column beside the diagram preview, not a strip under
// it — but that is an `md:` arrangement and this browser is ~414px wide, so the
// side-by-side geometry cannot be measured here. It is pinned by this file's
// VRT baselines (1280 wide) and by the e2e spec. What is measurable is the
// narrow fallback: below `md` the pane goes back under the diagram. Asserted as
// the row's computed flex-direction *and* the two rects not overlapping, so
// neither can drift on its own.
export const DetailPaneStacksBelowTheDiagram: Story = {
  loaders: [ensureInventoryProject],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const diagram = await canvas.findByTestId("inventory-diagram");
    const pane = canvas.getByTestId("inventory-detail-pane");
    const row = diagram.parentElement;
    if (!row) {
      throw new Error("the diagram preview should sit in the main row");
    }

    await expect(getComputedStyle(row).flexDirection).toBe("column");
    // The 1px slack absorbs sub-pixel rounding of the stacked heights.
    await expect(pane.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      diagram.getBoundingClientRect().bottom - 1,
    );
  },
};

/**
 * Every tab has to be reachable, not just present.
 *
 * Adding a fifth tab made the row wider than the pane takes, and the last one
 * was clipped off the right edge — still in the DOM, still findable by a test
 * that queries by role, and invisible to anyone using the page.
 *
 * The fix is a scrollable row, and that is what this pins: when the tabs do
 * not fit — which they cannot at this browser's ~414px, below `md` where the
 * pane is the full width — the row scrolls instead of clipping. A tab outside
 * the visible box is fine *because* the box scrolls; the same tab outside a
 * box that does not is gone. Whether they fit on a real screen is the VRT
 * baselines' job, at 1280 wide.
 */
export const EveryTabFitsInThePane: Story = {
  loaders: [ensureInventoryProject],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const pane = await canvas.findByTestId("inventory-detail-pane");
    const list = within(pane).getByRole("tablist", { name: "Entity details" });

    const names = [
      "Description",
      "Style",
      "Ports",
      "Requirements",
      "Metadata",
      "Delete",
    ];
    const tabs = within(list).getAllByRole("tab");
    await expect(tabs).toHaveLength(names.length);
    for (const name of names) {
      await expect(within(list).getByRole("tab", { name: new RegExp(name) }))
        .toBeTruthy();
    }

    // The row is its own scroll container, so an overlong tab list stays
    // reachable. Asserted as the computed value rather than a class name, so
    // a future refactor cannot leave the behaviour behind without the
    // behaviour going with it.
    await expect(getComputedStyle(list).overflowX).toBe("auto");
    // ...and at this width it genuinely does overflow, which is the case the
    // clipping regression was about. If a future tab list did fit, this would
    // fail and the question would be worth asking again.
    await expect(list.scrollWidth).toBeGreaterThan(list.clientWidth);
  },
};

// The documentation editor, open. Every other documentation story cancels back
// to the viewer, so without this one the editor's own layout inside the pane —
// its height, its border, where the Save/Cancel row sits — has no picture of it
// at all: a story that ends in edit mode is the only place the pane as a whole
// can be compared.
export const DocumentationEditorOpen: Story = {
  loaders: [ensureInventoryProject],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await openDocEditor(canvas);
    // Save and Cancel stay reachable below it.
    await expect(canvas.getByTestId("inventory-doc-save-button")).toBeTruthy();
    await expect(canvas.getByTestId("inventory-doc-cancel-button"))
      .toBeTruthy();
  },
};

// The same component attributes Modeling's inspector edits, on the Inventory
// page — which had them as read-only text in Metadata. The tab is the reuse:
// one set of controls, one place they can change the model.
//
// The write is asserted by reading `main.hcl` back off the VFS, because the
// interesting part is not that the select moved but that the model file
// changed. It is also the only assertion that catches the trap this reuses:
// an edit applied to the *instance* path would refuse here, since the
// Inventory holds definitions.
export const StyleTabEditsTheComponent: Story = {
  args: { requestedLabel: "styled-module" },
  loaders: [ensureInventoryProject],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("tab", { name: "Style" }));

    const style = within(await canvas.findByTestId("inventory-style-fields"));
    // Metadata shows these read-only; the Style tab is where they are edited,
    // so the icon autocomplete is here too rather than plain text.
    await expect(style.getByTestId("icon-autocomplete-wrapper")).toBeTruthy();
    await expect(style.getByLabelText(/^color$/i)).toBeTruthy();
    await expect(style.getByLabelText(/^border$/i)).toBeTruthy();
    await expect(style.getByLabelText(/^font$/i)).toBeTruthy();

    // Unstyled to start: the selects show their defaults, not a value the
    // fixture already carried.
    await expect(style.getByLabelText(/^color$/i)).toHaveValue("default");
    await expect(style.getByLabelText(/^border$/i)).toHaveValue("solid");
    await expect(style.getByLabelText(/^font$/i)).toHaveValue("unstyled");

    await userEvent.selectOptions(style.getByLabelText(/^color$/i), "warning");
    await userEvent.selectOptions(style.getByLabelText(/^border$/i), "dashed");
    await userEvent.selectOptions(style.getByLabelText(/^font$/i), "bold");

    // Persisted to the model file, on the definition and not on an instance.
    // Matched with a whitespace-tolerant pattern: the serializer aligns `=`
    // within a block, so an exact `color        = "warning"` would be
    // asserting a formatter property instead of the edit.
    const readModel = async (): Promise<string> =>
      await openProjectFs(projectStore, SEEDED_PROJECT_ID)
        .readFile("main.hcl");

    await waitFor(async () => {
      const hcl = await readModel();
      await expect(hcl).toMatch(/color\s+= "warning"/);
      await expect(hcl).toMatch(/border\s+= "dashed"/);
      await expect(hcl).toMatch(/font\s+= "bold"/);
    });
    // ...and it reached the definition's own block, not a sibling's. The
    // attribute list is closed to an extent (W012 warns on orphans), but
    // nothing stops a wrong path from landing the edit on another component.
    const hcl = await readModel();
    const block = hcl.slice(
      hcl.indexOf('component "styled-module"'),
      hcl.indexOf('system "demo-system"'),
    );
    await expect(block).toMatch(/color\s+= "warning"/);
    await expect(block).toMatch(/font\s+= "bold"/);
  },
};

// A system offers full name + icon only — the tab is the same shared
// controls in system mode, without the color/border/font selects, since
// systems carry no such attributes in the model. The write is asserted by
// reading `main.hcl` back, matching the component story's read-back style.
export const StyleTabEditsTheSystem: Story = {
  args: { requestedLabel: "aux-system" },
  loaders: [ensureInventoryProject],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("tab", { name: "Systems" })).toBeTruthy();
    await userEvent.click(canvas.getByRole("tab", { name: "Style" }));

    const style = within(await canvas.findByTestId("inventory-style-fields"));
    await expect(style.getByTestId("icon-autocomplete-wrapper")).toBeTruthy();
    await expect(style.getByLabelText(/full name/i)).toBeTruthy();
    // No component-only controls: these would offer edits `update_system`
    // rejects.
    await expect(style.queryByLabelText(/^color$/i)).toBeNull();
    await expect(style.queryByLabelText(/^border$/i)).toBeNull();
    await expect(style.queryByLabelText(/^font$/i)).toBeNull();

    // Type an icon name into the autocomplete and commit it.
    const iconInput = style.getByLabelText(/fontawesome/i);
    await userEvent.click(iconInput);
    await userEvent.clear(iconInput);
    await userEvent.type(iconInput, "microchip");
    // The dropdown offers the match; picking it commits the patch.
    await userEvent.click(
      within(await canvas.findByTestId("icon-suggestions-list"))
        .getByRole("option", { name: /microchip/i }),
    );

    const readModel = async (): Promise<string> =>
      await openProjectFs(projectStore, SEEDED_PROJECT_ID)
        .readFile("main.hcl");

    await waitFor(async () => {
      const hcl = await readModel();
      await expect(hcl).toMatch(/icon\s+= "microchip"/);
    });
    // ...and it reached the system's own block, not a sibling's.
    const hcl = await readModel();
    const block = hcl.slice(hcl.indexOf('system "aux-system"'));
    await expect(block).toMatch(/icon\s+= "microchip"/);
  },
};

// A component with live instances cannot be deleted: the tab names every
// placement instead of offering the confirm input, so there is nothing to
// click that would refuse. `battery` is instanced in demo-system.
export const DeleteTabBlockedForUsedComponent: Story = {
  args: { requestedLabel: "battery" },
  loaders: [ensureInventoryProject],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("tab", { name: "Delete" }));

    const tab = within(await canvas.findByTestId("inventory-delete-tab"));
    await expect(tab.getByText(/still used in/)).toBeTruthy();
    await expect(tab.getByText("demo-system/battery")).toBeTruthy();
    // Blocked means blocked: no confirm input, no confirm button.
    await expect(
      tab.queryByTestId("inventory-delete-confirm"),
    ).not.toBeInTheDocument();
  },
};

// A component with no instances deletes through the type-to-confirm gate:
// the button stays disabled until the input names the label, and the model
// file loses the block. `draft-module` is never instanced.
export const DeleteTabDeletesUnusedComponent: Story = {
  args: { requestedLabel: "draft-module" },
  loaders: [ensureInventoryProject],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("tab", { name: "Delete" }));

    const tab = within(await canvas.findByTestId("inventory-delete-tab"));
    const confirm = tab.getByTestId("inventory-delete-confirm");
    // Wrong text keeps the button disabled — the gate is the match, not
    // the click.
    await userEvent.type(
      tab.getByLabelText(/type "draft-module" to confirm/i),
      "draft-modul",
    );
    await expect(confirm).toBeDisabled();
    await userEvent.type(
      tab.getByLabelText(/type "draft-module" to confirm/i),
      "e",
    );
    await expect(confirm).not.toBeDisabled();
    await userEvent.click(confirm);

    const readModel = async (): Promise<string> =>
      await openProjectFs(projectStore, SEEDED_PROJECT_ID)
        .readFile("main.hcl");
    await waitFor(async () => {
      const hcl = await readModel();
      await expect(hcl).not.toContain('component "draft-module"');
    });
  },
};

// A system with bound views cannot be deleted: removing it would leave
// `views/demo-system.hcl` dangling with E006, so the tab lists the files
// to delete first instead of offering the confirm input.
export const DeleteTabBlockedForSystemWithViews: Story = {
  args: { requestedLabel: "demo-system" },
  loaders: [ensureInventoryProject],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("tab", { name: "Systems" }));
    await userEvent.click(canvas.getByText("demo-system"));
    await userEvent.click(canvas.getByRole("tab", { name: "Delete" }));

    const tab = within(await canvas.findByTestId("inventory-delete-tab"));
    await expect(tab.getByText(/still has bound views/)).toBeTruthy();
    await expect(tab.getByText("views/demo-system.hcl")).toBeTruthy();
    await expect(
      tab.queryByTestId("inventory-delete-confirm"),
    ).not.toBeInTheDocument();
  },
};
