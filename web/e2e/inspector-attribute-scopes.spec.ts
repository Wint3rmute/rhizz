import { expect, test } from "@playwright/test";
import { createNewProject } from "./helpers";

// The two halves of the inspector write to two different files, and that is
// invisible until you look for it: edit a color and a text alignment, reopen
// the same view elsewhere, and one of them is still there.
//
// This drives both edits through the real UI and reads the VFS back, so it
// pins the *destination* rather than the control's state. Runs against
// localStorage (the default e2e backend): what is under test is which file
// each control writes to, which is a property of the frontend, not of a
// backend.
const VFS_KEY = "rhizz:vfs:v1";

/** Every file in the VFS, keyed by its project-relative path. */
async function storedFiles(page: import("@playwright/test").Page) {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    if (raw === null) throw new Error("no VFS in localStorage");
    const blob = JSON.parse(raw) as {
      nodes: {
        id: string;
        parentId: string | null;
        name: string;
        kind: string;
        content?: string;
      }[];
    };
    const pathOf = (node: (typeof blob.nodes)[number]): string => {
      const parts = [node.name];
      let parent = node.parentId;
      while (parent !== null) {
        const found = blob.nodes.find((n) => n.id === parent);
        if (found === undefined) break;
        parts.unshift(found.name);
        parent = found.parentId;
      }
      return parts.join("/");
    };
    const files: Record<string, string> = {};
    for (const node of blob.nodes) {
      if (node.kind !== "file") continue;
      files[pathOf(node)] = node.content ?? "";
    }
    return files;
  }, VFS_KEY);
}

// A fresh project with one component already placed on `main`, so the
// inspector is reachable without driving the creation modal.
async function openInspector(page: import("@playwright/test").Page, name: string) {
  const id = await createNewProject(page, name);
  await page.goto(`/projects/${id}/modeling`);
  await expect(page.getByTestId("diagram-toolbar")).toBeVisible();

  await page.getByRole("button", { name: "+ Component" }).click();
  const modal = page.getByTestId("create-component-modal");
  await expect(modal).toBeVisible();
  await modal.locator("#new-comp-name").fill("e2e-scopes");
  await modal.getByRole("button", { name: "Create Definition" }).click();
  await expect(modal).toBeHidden();

  const node = page.getByTestId("diagram-canvas").getByText("e2e-scopes").first();
  const box = await node.boundingBox();
  if (!box) throw new Error("created node has no bounding box");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByTestId("node-inspector")).toBeVisible();
  return id;
}

test("the inspector's two panels name the file each half writes to", async ({ page }) => {
  await openInspector(page, "E2E inspector panels");

  // Both panels are present, and the split is by *destination* — which is the
  // whole point, so each heading has to say it.
  const component = page.getByTestId("component-attributes");
  const view = page.getByTestId("view-attributes");
  await expect(component).toBeVisible();
  await expect(view).toBeVisible();
  await expect(page.getByTestId("component-attributes-heading"))
    .toHaveAttribute("data-tip", /system\.hcl/);
  await expect(page.getByTestId("view-attributes-heading"))
    .toHaveAttribute("data-tip", /views\//);

  // The alignment control is in the view panel and the color select is not —
  // the visible half of the same distinction the tooltips describe.
  await expect(view.getByText("Text alignment")).toBeVisible();
  await expect(component.locator("#comp-color-input")).toBeVisible();
  await expect(view.locator("#comp-color-input")).toHaveCount(0);
});

test("a style edit rewrites the model and an alignment edit rewrites the view", async ({ page }) => {
  const id = await openInspector(page, "E2E inspector destinations");

  await page.locator("#comp-color-input").selectOption("warning");
  await page.getByRole("button", { name: "Top-left", exact: true }).click();

  // The layout write is debounced (500ms, Task 118), so wait for the view
  // file to carry the alignment rather than reading it straight away.
  await expect
    .poll(async () => {
      const files = await storedFiles(page);
      return files["views/main.hcl"] ?? "";
    }, { timeout: 10_000 })
    .toContain('text_align = "top-left"');

  const files = await storedFiles(page);
  const model = files["main.hcl"] ?? files["system.hcl"] ?? "";
  expect(model).toMatch(/color\s+= "warning"/);

  // ...and each file carries only its own half. A color leaking into the view
  // would be invisible on screen until the file was opened.
  const view = files["views/main.hcl"];
  expect(view).not.toMatch(/color\s+=/);
  expect(model).not.toContain("text_align");
});

test("the Inventory Style tab writes to the model, not the view", async ({ page }) => {
  const id = await openInspector(page, "E2E inventory style write");
  await page.locator("#comp-color-input").selectOption("accent");

  await page.goto(`/projects/${id}/inventory/e2e-scopes`);
  const pane = page.getByTestId("inventory-detail-pane");
  await expect(pane).toBeVisible();
  await page.getByRole("tab", { name: "Style" }).click();

  // The value Modeling set is the value the tab opens on — the same model,
  // read through a different projection.
  await expect(pane.locator("#comp-color-input")).toHaveValue("accent");

  await pane.locator("#comp-border-input").selectOption("dotted");

  await expect
    .poll(async () => {
      const files = await storedFiles(page);
      return files["main.hcl"] ?? files["system.hcl"] ?? "";
    }, { timeout: 10_000 })
    .toMatch(/border\s+= "dotted"/);

  const files = await storedFiles(page);
  const model = files["main.hcl"] ?? files["system.hcl"] ?? "";
  expect(model).toMatch(/color\s+= "accent"/);
  expect(model).toMatch(/border\s+= "dotted"/);
  // The definition is what the Inventory addresses, so the edit has to land
  // on the definition block and not on an instance of it.
  expect(model).not.toContain("text_align");
  expect(files["views/e2e-scopes.hcl"]).toBeUndefined();
  // ...and it must not leak into the view file either. This is the assertion
  // that makes the test about *where* the edit went: reaching the model is
  // also true of a write that reached both.
  const view = files["views/main.hcl"] ?? "";
  expect(view).not.toMatch(/dotted/);
  expect(view).not.toMatch(/accent/);
});