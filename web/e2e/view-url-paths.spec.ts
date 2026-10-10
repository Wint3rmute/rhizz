import { expect, type Page, test } from "@playwright/test";
import { createNewProject } from "./helpers";

// The open view (Modeling) and the inspected entity (Inventory) are part of
// the URL path, so either can be shared as a link and the browser's back /
// forward buttons move between them like they move between pages.
//
// A view is addressed by its path relative to `views/`
// (`/projects/<id>/modeling/drone/airframe.hcl`), an entity by its label
// (`/projects/<id>/inventory/battery`) — the same shape the embed route
// already uses for diagrams.

async function createDefinition(page: Page, label: string): Promise<void> {
  await page.getByRole("button", { name: "+ Component" }).click();
  const modal = page.getByTestId("create-component-modal");
  await expect(modal).toBeVisible();
  await modal.locator("#new-comp-name").fill(label);
  await modal.getByRole("button", { name: "Create Definition" }).click();
  await expect(modal).toBeHidden();
}

function diagramsTree(page: Page) {
  return page.getByTestId("modeling-pane-left");
}

function card(page: Page, label: string) {
  return page.getByTestId("inventory-card").filter({ hasText: label });
}

test("modeling keeps the open view in the URL path", async ({ page }) => {
  const id = await createNewProject(page, "E2E view url");
  await page.goto(`/projects/${id}/modeling`);
  await expect(page.getByTestId("diagram-canvas")).toBeVisible();

  // A bare /modeling URL opens the first view and rewrites itself to name it,
  // so the address bar is shareable from the first paint.
  await expect(page).toHaveURL(`/projects/${id}/modeling/main.hcl`);

  // A second view, created through Inventory's "create a view" action, lands
  // in Modeling on its own path.
  await createDefinition(page, "e2e-second-view");
  await page.goto(`/projects/${id}/inventory/e2e-second-view`);
  await expect(card(page, "e2e-second-view")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByTestId("inventory-create-view").click();
  await expect(page).toHaveURL(
    `/projects/${id}/modeling/e2e-second-view.hcl`,
  );
  await expect(page.getByTestId("diagram-canvas")).toBeVisible();

  // Switching views in the sidebar is a navigation: the tree marks the open
  // one and the URL follows.
  const tree = diagramsTree(page);
  await expect(tree.getByRole("button", { name: "e2e-second-view.hcl" }))
    .toHaveAttribute("aria-current", "true");
  await tree.getByRole("button", { name: "main.hcl", exact: true }).click();
  await expect(page).toHaveURL(`/projects/${id}/modeling/main.hcl`);
  await expect(tree.getByRole("button", { name: "main.hcl", exact: true }))
    .toHaveAttribute("aria-current", "true");

  // ...which is exactly what the browser's back / forward buttons undo.
  await page.goBack();
  await expect(page).toHaveURL(
    `/projects/${id}/modeling/e2e-second-view.hcl`,
  );
  await expect(tree.getByRole("button", { name: "e2e-second-view.hcl" }))
    .toHaveAttribute("aria-current", "true");
  await page.goForward();
  await expect(page).toHaveURL(`/projects/${id}/modeling/main.hcl`);

  // A shared link opens that view — the canvas is the same either way, the
  // open sidebar row is what tells them apart.
  await page.goto(`/projects/${id}/modeling/e2e-second-view.hcl`);
  await expect(tree.getByRole("button", { name: "e2e-second-view.hcl" }))
    .toHaveAttribute("aria-current", "true");
});

test("a view nested in a folder keeps its whole path in the URL", async ({ page }) => {
  const id = await createNewProject(page, "E2E nested view url");
  await page.goto(`/projects/${id}/modeling`);
  await expect(page).toHaveURL(`/projects/${id}/modeling/main.hcl`);

  const tree = diagramsTree(page);
  page.once("dialog", (dialog) => void dialog.accept("sub"));
  await tree.getByRole("button", { name: "+ Folder" }).click();
  const folder = tree.getByRole("button", { name: "sub", exact: true });
  await expect(folder).toBeVisible();

  // The row's own "+ file" button only appears on hover.
  const row = folder.locator("xpath=..");
  await row.hover();
  await row.getByTitle("New file").click();
  const modal = page.getByTestId("new-view-modal");
  await expect(modal).toBeVisible();
  await modal.locator("#new-view-name").fill("nested");
  await modal.getByRole("button", { name: "Create View" }).click();
  await expect(modal).toBeHidden();

  // One rest param, not a single segment: the folder is part of the address.
  await expect(page).toHaveURL(
    `/projects/${id}/modeling/sub/nested.hcl`,
  );
  await expect(tree.getByRole("button", { name: "nested.hcl" }))
    .toHaveAttribute("aria-current", "true");
});

test("a legacy ?diagram= link still opens its view, then redirects to the path", async ({ page }) => {
  const id = await createNewProject(page, "E2E legacy view url");
  // Links shared before views moved into the URL path (the "Open in Rhizz"
  // button used to hand out `?diagram=views/<name>.hcl`) must keep working.
  await page.goto(`/projects/${id}/modeling?diagram=views%2Fmain.hcl`);
  await expect(page).toHaveURL(`/projects/${id}/modeling/main.hcl`);
  await expect(page.getByTestId("diagram-canvas")).toBeVisible();
});

test("deleting another view leaves the open one alone", async ({ page }) => {
  const id = await createNewProject(page, "E2E delete other view");
  await page.goto(`/projects/${id}/modeling`);
  await expect(page).toHaveURL(`/projects/${id}/modeling/main.hcl`);

  // A second view to delete: a folder, so the delete covers the whole subtree.
  const tree = diagramsTree(page);
  page.once("dialog", (dialog) => void dialog.accept("spare"));
  await tree.getByRole("button", { name: "+ Folder" }).click();
  const folder = tree.getByRole("button", { name: "spare", exact: true });
  const row = folder.locator("xpath=..");
  await row.hover();
  await row.getByTitle("New file").click();
  const modal = page.getByTestId("new-view-modal");
  await modal.locator("#new-view-name").fill("unused");
  await modal.getByRole("button", { name: "Create View" }).click();
  await expect(page).toHaveURL(
    `/projects/${id}/modeling/spare/unused.hcl`,
  );

  // Back on main.hcl, deleting the folder is a no-op for the open view: the
  // canvas keeps its nodes and the URL keeps naming it.
  await tree.getByRole("button", { name: "main.hcl", exact: true }).click();
  await expect(page).toHaveURL(`/projects/${id}/modeling/main.hcl`);
  await createDefinition(page, "e2e-kept");
  const kept = page.getByTestId("diagram-canvas").getByText("e2e-kept").first();
  await expect(kept).toBeVisible();

  // The row's own buttons only appear on hover, and the delete one is a bare
  // 🗑 next to ✎ — it is found by its glyph, not by an accessible name.
  const spareRow = tree.getByRole("button", { name: "spare", exact: true })
    .locator("xpath=..");
  await spareRow.hover();
  page.once("dialog", (dialog) => void dialog.accept());
  await spareRow.locator("button", { hasText: "🗑" }).click();

  await expect(tree.getByRole("button", { name: "spare", exact: true }))
    .toHaveCount(0);
  await expect(page).toHaveURL(`/projects/${id}/modeling/main.hcl`);
  await expect(kept).toBeVisible();
});

test("inventory keeps the inspected entity in the URL path", async ({ page }) => {
  const id = await createNewProject(page, "E2E entity url");
  await page.goto(`/projects/${id}/modeling`);
  await createDefinition(page, "e2e-alpha");
  await createDefinition(page, "e2e-beta");

  await page.goto(`/projects/${id}/inventory`);
  // Nothing in the path yet: the first entity is opened and written back, so
  // the address bar is shareable from the first paint.
  await expect(page).toHaveURL(
    new RegExp(`/projects/${id}/inventory/e2e-(alpha|beta)$`),
  );
  const first = new URL(page.url()).pathname.split("/").at(-1);

  // Selecting an entity is a navigation.
  await card(page, "e2e-beta").click();
  await expect(page).toHaveURL(`/projects/${id}/inventory/e2e-beta`);
  await expect(card(page, "e2e-beta")).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // ...which is exactly what the browser's back / forward buttons undo.
  await page.goBack();
  await expect(page).toHaveURL(`/projects/${id}/inventory/${first}`);
  await expect(card(page, first ?? "")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.goForward();
  await expect(page).toHaveURL(`/projects/${id}/inventory/e2e-beta`);
  await expect(card(page, "e2e-beta")).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // A shared link (including after a reload) opens that entity's detail —
  // here the doc slot naming the entity's own `docs/<label>.md` file.
  await page.reload();
  await expect(page).toHaveURL(`/projects/${id}/inventory/e2e-beta`);
  await expect(card(page, "e2e-beta")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId("inventory-doc-viewer")).toContainText(
    "docs/e2e-beta.md",
  );
});
