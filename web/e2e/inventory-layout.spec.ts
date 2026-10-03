import { expect, test } from "@playwright/test";

// Inventory's workspace arrangement: the detail pane stands to the *right* of
// the diagram preview, and the row splits 60/40 in the diagram's favour.
//
// This lives in e2e rather than in a story because it needs the desktop
// arrangement: the pane only sits beside the diagram from the `md` breakpoint
// up, and the Vitest story browser renders ~414px wide (see the
// `DetailPaneStacksBelowTheDiagram` story for the narrow fallback). Playwright
// runs at its 1280px default, which is above it.
//
// No definition is created: the split is two CSS widths on the row, so an
// empty pane is as good a witness as a filled one — and a pane whose width
// turned out to depend on its content would fail the ratio below either way.
async function openInventory(page, name: string) {
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
  await page.goto(`/projects/${id}/inventory`);
}

test("inventory puts the detail pane beside the diagram preview", async ({ page }) => {
  await openInventory(page, "E2E inventory layout");

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

  // 60/40 in the diagram's favour, as a share of the row the two split.
  // Stated as a ratio rather than two absolute widths so it says what the
  // layout is for, and so it holds at whatever window width this runs at — a
  // half-and-half split, or a fixed pixel width, fails here instead of
  // passing unnoticed.
  const share = detail.width / (chart.width + detail.width);
  expect(share).toBeGreaterThan(0.38);
  expect(share).toBeLessThan(0.42);
});
