import { expect, test } from "@playwright/test";
import { createNewProject } from "./helpers";

// Inventory → Systems: a fresh project holds one system ("main") and no
// definitions, so the Systems tab is where its only entity lives. Selecting
// it previews the same-named diagram when one exists, and otherwise offers
// to create it — bound to the system itself.

test("inventory systems tab previews the same-named diagram, or offers to create it", async ({ page }) => {
  const id = await createNewProject(page, "E2E inventory systems");

  await page.goto(`/projects/${id}/inventory`);
  // The filter is Components / Systems / Interfaces now — no "All".
  await expect(
    page.getByRole("tab", { name: "Components" }),
  ).toBeVisible();
  await expect(page.getByRole("tab", { name: "Systems" })).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "Interfaces" }),
  ).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "All", exact: true }),
  ).toHaveCount(0);

  await page.getByRole("tab", { name: "Systems" }).click();
  await page.getByText("main").first().click();
  await expect(page).toHaveURL(`/projects/${id}/inventory/main`);

  // No views/main.hcl in a fresh project: the empty state names it and
  // offers the system-worded button.
  const emptyState = page.getByTestId("inventory-empty-diagram");
  await expect(emptyState).toBeVisible();
  await expect(emptyState).toContainText("views/main.hcl");
  await emptyState
    .getByRole("button", { name: "Create a view for this system" })
    .click();

  // Lands in Modeling on the new view's own path, bound to the system.
  await expect(page).toHaveURL(`/projects/${id}/modeling/main.hcl`);
  await expect(page.getByTestId("diagram-toolbar")).toBeVisible();
  await expect(page.getByTestId("diagram-system-label")).toContainText(
    "system: main",
  );

  // Back in Inventory the empty state is gone: the view loads as a preview.
  await page.goto(`/projects/${id}/inventory/main`);
  await expect(page.getByTestId("inventory-empty-diagram")).toBeHidden();
});

test("inventory add buttons create systems and components", async ({ page }) => {
  const id = await createNewProject(page, "E2E inventory add");

  await page.goto(`/projects/${id}/inventory`);
  // Components is the default tab, so its button shows first. It opens
  // the shared creation modal locked to new definitions — no reuse mode.
  const addComponent = page.getByTestId("inventory-add-entity");
  await expect(addComponent).toHaveText("+ New Component");
  await addComponent.click();
  const modal = page.getByTestId("create-component-modal");
  await expect(modal).toBeVisible();
  await expect(
    modal.getByRole("button", { name: "Use Existing Component" }),
  ).toHaveCount(0);
  await modal.locator("#new-comp-name").fill("e2e-comp");
  await modal.getByRole("button", { name: "Create Definition" }).click();
  await expect(modal).toBeHidden();
  await expect(page).toHaveURL(`/projects/${id}/inventory/e2e-comp`);
  await page.getByText("e2e-comp").first().click();

  // The Systems tab offers the system-worded button instead. It opens a
  // name-only creation modal in the same style as the component one.
  await page.getByRole("tab", { name: "Systems" }).click();
  const addSystem = page.getByTestId("inventory-add-entity");
  await expect(addSystem).toHaveText("+ New System");
  await addSystem.click();
  const sysModal = page.getByTestId("create-system-modal");
  await expect(sysModal).toBeVisible();
  await sysModal.locator("#new-sys-name").fill("e2e-sys");
  await sysModal.getByRole("button", { name: "Create System" }).click();
  await expect(sysModal).toBeHidden();
  await expect(page).toHaveURL(`/projects/${id}/inventory/e2e-sys`);

  // The new system is a real entity: it previews (missing-view state) and
  // the overview counts it.
  await expect(page.getByTestId("inventory-empty-diagram")).toBeVisible();
  await page.goto(`/projects/${id}/overview`);
  const stat = page.locator(".stat").filter({
    has: page.getByText("Systems", { exact: true }),
  });
  await expect(stat).toContainText("2");

  // Interfaces has nothing to add: no button there.
  await page.goto(`/projects/${id}/inventory`);
  await page.getByRole("tab", { name: "Interfaces" }).click();
  await expect(page.getByTestId("inventory-add-entity")).toHaveCount(0);
});
