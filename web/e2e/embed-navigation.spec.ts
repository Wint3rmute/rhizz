import { expect, test } from "@playwright/test";

// Embed mode drill-down: nodes with a matching detail view navigate within
// the embed route (back/forward friendly); nodes without one toast — the
// same feedback Explore shows. No worked example ships a label-named
// detail view, so the test creates one via Inventory first.
async function openDiagram(page, name = "E2E embed navigation") {
  await page.goto("/");
  const create = page.getByRole("button", { name: "New project" }).first();
  await expect(create).toBeVisible();
  page.on("dialog", (dialog) => void dialog.accept(name));
  await create.click();
  await expect(page).toHaveURL(/\/projects\/.+\/(code|overview)/);
  const tourDialog = page.getByRole("alertdialog");
  await expect(tourDialog).toBeVisible();
  await tourDialog.getByRole("button", { name: "skip tour" }).click();
  await expect(tourDialog).toBeHidden();
  const id = new URL(page.url()).pathname.split("/")[2];
  if (!id) throw new Error("project id missing from URL");
  await page.goto(`/projects/${id}/modeling`);
  await expect(page.getByTestId("diagram-toolbar")).toBeVisible();
  await expect(page.getByTestId("diagram-canvas")).toBeVisible();
  return id;
}

async function createComponent(page, label: string) {
  await page.getByRole("button", { name: "+ Component" }).click();
  const modal = page.getByTestId("create-component-modal");
  await expect(modal).toBeVisible();
  await modal.locator("#new-comp-name").fill(label);
  await modal.getByRole("button", { name: "Create Definition" }).click();
  await expect(modal).toBeHidden();
  const canvas = page.getByTestId("diagram-canvas");
  await expect(canvas.getByText(label).first()).toBeVisible();
}

test("embed navigates back and forth through linked views", async ({ page }) => {
  const id = await openDiagram(page);
  await createComponent(page, "e2e-nav-widget");
  await createComponent(page, "e2e-nav-plain");

  // Both nodes land at the viewport center and overlap — drag the plain
  // one well aside so each link is clickable on its own. (Embed's
  // auto-fit viewport can still stack them tightly, so the clicks below
  // use force: true — the real handler still fires and the URL/toast
  // assertions prove it.)
  const modelingCanvas = page.getByTestId("diagram-canvas");
  const plainNode = modelingCanvas.getByText("e2e-nav-plain").first();
  const plainBox = await plainNode.boundingBox();
  if (!plainBox) throw new Error("created node has no bounding box");
  const fromX = plainBox.x + plainBox.width / 2;
  const fromY = plainBox.y + plainBox.height / 2;
  await page.mouse.move(fromX, fromY);
  await page.mouse.down();
  await page.mouse.move(fromX + 350, fromY + 220, { steps: 12 });
  await page.mouse.up();

  // Create the detail view views/e2e-nav-widget.hcl via Inventory, so the
  // widget node becomes linked while e2e-nav-plain stays unlinked.
  await page.goto(`/projects/${id}/inventory`);
  await page.getByText("e2e-nav-widget").first().click();
  const emptyState = page.getByTestId("inventory-empty-diagram");
  await expect(emptyState).toBeVisible();
  await emptyState
    .getByRole("button", { name: "Create a view for this component" })
    .click();
  await expect(page).toHaveURL(
    /\/modeling\?diagram=views%2Fe2e-nav-widget\.hcl/,
  );

  // Open the main diagram in embed mode: both nodes are placed there.
  await page.goto(`/projects/${id}/modeling/embed/main.hcl`);
  const canvas = page.locator("svg").first();
  await expect(canvas).toBeVisible();

  const linked = page.getByRole("link", {
    name: /e2e-nav-widget, open detailed view/i,
  });
  await expect(linked).toBeVisible();
  await expect(
    page.getByRole("link", { name: /e2e-nav-plain, no detailed view/i }),
  ).toBeVisible();

  // Linked node navigates the embed URL to the detail view. Clicked via
  // JS (not hit-tested): both fixture nodes sit near the viewport center
  // and their SVG hit rects overlap, so a real mouse click can land on the
  // wrong node — the URL assertion below is what proves the wiring.
  await linked.evaluate((el: SVGElement) =>
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }))
  );
  await expect(page).toHaveURL(/\/modeling\/embed\/e2e-nav-widget\.hcl/);

  // ...and browser back returns to the previous diagram.
  await page.goBack();
  await expect(page).toHaveURL(/\/modeling\/embed\/main\.hcl/);

  // An unlinked node toasts instead of navigating (JS click, same
  // overlap reason as above).
  const urlBefore = page.url();
  await page
    .getByRole("link", { name: /e2e-nav-plain, no detailed view/i })
    .evaluate((el: SVGElement) =>
      el.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    );
  await expect(page.getByText(/no detailed view for e2e-nav-plain created/i))
    .toBeVisible();
  expect(page.url()).toBe(urlBefore);
});
