import { expect, type Page, test } from "@playwright/test";
import { createNewProject } from "./helpers";

// Inventory's "Only with defined views" checkbox. It appears on the
// Components and Systems tabs (never Interfaces) and narrows the list to
// entities that actually have a view: a definition whose `views/<label>.hcl`
// source exists, or a system bound by at least one view file. The checkbox is
// one shared state, so it survives switching tabs.
//
// Seed: two components (one with a view, one without) and two systems
// ("main" without a view, "with-view-sys" with one).
async function openInventory(page: Page, id: string): Promise<void> {
  await page.goto(`/projects/${id}/inventory`);
}

async function createComponent(
  page: Page,
  id: string,
  name: string,
): Promise<void> {
  await openInventory(page, id);
  await page.getByTestId("inventory-add-entity").click();
  const modal = page.getByTestId("create-component-modal");
  await expect(modal).toBeVisible();
  await modal.locator("#new-comp-name").fill(name);
  await modal.getByRole("button", { name: "Create Definition" }).click();
  await expect(modal).toBeHidden();
}

async function createSystem(
  page: Page,
  id: string,
  name: string,
): Promise<void> {
  await openInventory(page, id);
  await page.getByRole("tab", { name: "Systems" }).click();
  await page.getByTestId("inventory-add-entity").click();
  const modal = page.getByTestId("create-system-modal");
  await expect(modal).toBeVisible();
  await modal.locator("#new-sys-name").fill(name);
  await modal.getByRole("button", { name: "Create System" }).click();
  await expect(modal).toBeHidden();
}

/** Creates the definition/system's own view (`views/<label>.hcl`) through the
 * empty-diagram button, which lands in Modeling. */
async function createViewFor(
  page: Page,
  id: string,
  label: string,
  kind: "component" | "system",
): Promise<void> {
  await page.goto(`/projects/${id}/inventory/${label}`);
  const buttonName = kind === "system"
    ? "Create a view for this system"
    : "Create a view for this component";
  await page.getByTestId("inventory-empty-diagram")
    .getByRole("button", { name: buttonName })
    .click();
  await expect(page).toHaveURL(`/projects/${id}/modeling/${label}.hcl`);
}

async function seedComponentViews(page: Page, name: string): Promise<string> {
  const id = await createNewProject(page, name);
  await createComponent(page, id, "has-view");
  await createViewFor(page, id, "has-view", "component");
  await createComponent(page, id, "no-view");
  return id;
}

/** Component views bind to the system that instantiates the definition (here
 * the fallback "main"), so the systems seed must not create one — otherwise
 * "main" counts as view-bound and the filter could not hide it. */
async function seedSystemViews(page: Page, name: string): Promise<string> {
  const id = await createNewProject(page, name);
  await createSystem(page, id, "with-view-sys");
  await createViewFor(page, id, "with-view-sys", "system");
  return id;
}

/** A card in the Inventory Browser sidebar (not the detail pane). */
function card(page: Page, label: string) {
  return page.getByTestId("inventory-pane-left")
    .getByTestId("inventory-card")
    .filter({ hasText: label });
}

function viewFilter(page: Page) {
  return page.getByRole("checkbox", { name: "Only with defined views" });
}

test("the view filter shows on Components and Systems but not Interfaces", async ({ page }) => {
  const id = await createNewProject(page, "E2E view filter visibility");
  await openInventory(page, id);

  await expect(viewFilter(page)).toBeVisible();
  await page.getByRole("tab", { name: "Systems" }).click();
  await expect(viewFilter(page)).toBeVisible();
  await page.getByRole("tab", { name: "Interfaces" }).click();
  await expect(viewFilter(page)).toHaveCount(0);
  await page.getByRole("tab", { name: "Components" }).click();
  await expect(viewFilter(page)).toBeVisible();
});

test("filtering components keeps only definitions with a view file", async ({ page }) => {
  const id = await seedComponentViews(page, "E2E view filter components");
  await openInventory(page, id);

  // Before filtering, both definitions are listed.
  await expect(card(page, "has-view")).toHaveCount(1);
  await expect(card(page, "no-view")).toHaveCount(1);

  await viewFilter(page).check();

  await expect(card(page, "has-view")).toHaveCount(1);
  await expect(card(page, "no-view")).toHaveCount(0);
});

test("filtering systems keeps only systems bound to a view", async ({ page }) => {
  const id = await seedSystemViews(page, "E2E view filter systems");
  await openInventory(page, id);
  await page.getByRole("tab", { name: "Systems" }).click();

  await expect(card(page, "main")).toHaveCount(1);
  await expect(card(page, "with-view-sys")).toHaveCount(1);

  await viewFilter(page).check();

  await expect(card(page, "with-view-sys")).toHaveCount(1);
  await expect(card(page, "main")).toHaveCount(0);
});

test("the view filter state survives switching tabs", async ({ page }) => {
  const id = await seedComponentViews(page, "E2E view filter persists");
  await openInventory(page, id);

  await viewFilter(page).check();
  await expect(viewFilter(page)).toBeChecked();

  await page.getByRole("tab", { name: "Systems" }).click();
  await expect(viewFilter(page)).toBeChecked();

  // Hidden on Interfaces, but the shared state is not reset.
  await page.getByRole("tab", { name: "Interfaces" }).click();
  await expect(viewFilter(page)).toHaveCount(0);

  await page.getByRole("tab", { name: "Components" }).click();
  await expect(viewFilter(page)).toBeChecked();
});

test("the add button sits in the tab row and still creates an entity", async ({ page }) => {
  const id = await createNewProject(page, "E2E add row");
  await openInventory(page, id);

  const tabRow = page.getByRole("tablist", { name: "Inventory filters" });
  const addButton = page.getByTestId("inventory-add-entity");
  await expect(addButton).toBeVisible();

  // Same vertical band as the tabs — the button moved into the row and did
  // not drop below it.
  const tabBox = await tabRow.boundingBox();
  const buttonBox = await addButton.boundingBox();
  if (!tabBox || !buttonBox) {
    throw new Error("tab row and button should be laid out");
  }
  expect(buttonBox.y).toBeLessThan(tabBox.y + tabBox.height);
  expect(buttonBox.y + buttonBox.height).toBeGreaterThan(tabBox.y);

  // Still a working creation entry point.
  await addButton.click();
  const modal = page.getByTestId("create-component-modal");
  await expect(modal).toBeVisible();
  await modal.locator("#new-comp-name").fill("row-comp");
  await modal.getByRole("button", { name: "Create Definition" }).click();
  await expect(modal).toBeHidden();
  await expect(page).toHaveURL(`/projects/${id}/inventory/row-comp`);
});
