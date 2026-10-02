import { expect, test } from "@playwright/test";

// Inventory's workspace arrangement: the detail pane stands to the *right* of
// the diagram preview, and the two split the main column about evenly.
//
// This lives in e2e rather than in a story because it needs the desktop
// arrangement: the pane only sits beside the diagram from the `md` breakpoint
// up, and the Vitest story browser renders ~414px wide (see the
// `DetailPaneStacksBelowTheDiagram` story for the narrow fallback). Playwright
// runs at its 1280px default, which is above it.
async function openInventoryWithComponent(page, name: string) {
  await page.goto("/");
  const create = page.getByRole("button", { name: "New project" }).first();
  await expect(create).toBeVisible();
  page.once("dialog", (dialog) => void dialog.accept(name));
  await create.click();
  await expect(page).toHaveURL(/\/projects\/.+\/(code|overview)/);
  const tourDialog = page.getByRole("alertdialog");
  await expect(tourDialog).toBeVisible();
  await tourDialog.getByRole("button", { name: "skip tour" }).click();
  await expect(tourDialog).toBeHidden();
  const id = new URL(page.url()).pathname.split("/")[2];
  if (!id) throw new Error("project id missing from URL");

  // One definition, so the pane is filled rather than showing its empty state —
  // a pane whose content cannot influence its width is a weaker witness of the
  // split than one holding a full name and ports.
  await page.goto(`/projects/${id}/modeling`);
  await page.getByRole("button", { name: "+ Component" }).click();
  const modal = page.getByTestId("create-component-modal");
  await expect(modal).toBeVisible();
  await modal.locator("#new-comp-name").fill("e2e-layout");
  await modal.getByRole("button", { name: "Create Definition" }).click();
  await expect(modal).toBeHidden();

  await page.goto(`/projects/${id}/inventory`);
  return id;
}

test("inventory puts the detail pane beside the diagram preview", async ({ page }) => {
  await openInventoryWithComponent(page, "E2E inventory layout");

  const diagram = page.getByTestId("inventory-diagram");
  const pane = page.getByTestId("inventory-detail-pane");
  await expect(diagram).toBeVisible();
  await expect(pane).toBeVisible();

  const chart = await diagram.boundingBox();
  const detail = await pane.boundingBox();
  if (!chart || !detail) throw new Error("both panes should be laid out");

  // Beside, not below: the pane starts where the diagram's right edge is, and
  // the two share a vertical band instead of being stacked. The 1px slack
  // absorbs sub-pixel rounding of the flex split.
  expect(detail.x).toBeGreaterThanOrEqual(chart.x + chart.width - 1);
  expect(detail.y).toBeLessThan(chart.y + chart.height);

  // "About the same space": the split is even to within 10%, so the pane
  // neither squeezes the canvas nor swallows the workspace.
  expect(Math.abs(chart.width - detail.width)).toBeLessThanOrEqual(
    chart.width * 0.1,
  );
});
