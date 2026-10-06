import { expect, test } from "@playwright/test";
import { createFromExample } from "./helpers";

// The layout-level diagnostics status bar is visible on every project
// subpage (but never inside chrome-free diagram embeds).
async function openProject(page, name = "E2E status bar") {
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
  return id;
}

test("diagnostics status bar shows on overview, code, and modeling", async ({ page }) => {
  const id = await openProject(page);
  const bar = page.getByTestId("diagnostics-status-bar");

  await page.goto(`/projects/${id}/overview`);
  await expect(bar).toBeVisible();

  await page.goto(`/projects/${id}/code`);
  await expect(bar).toBeVisible();

  await page.goto(`/projects/${id}/modeling`);
  await expect(bar).toBeVisible();
  // The bar expands and collapses again in place.
  await bar.getByRole("button").click();
  await expect(bar.getByRole("button")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await bar.getByRole("button").click();
  await expect(bar.getByRole("button")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
});

// The two project-wide controls live *in* the bar now: the score badge at its
// far left, the strictness control at its far right. Both used to sit in the
// navbar, so the navbar must not keep a copy — one score and one level
// control, each in the place the bar says it is.
test("the score badge and strictness control live in the bar, not the navbar", async ({ page }) => {
  // An example, not an empty project: the score badge only renders while a
  // score exists, and only Modeling publishes one.
  const id = await createFromExample(
    page,
    /Quadcopter Drone/,
    "E2E bar controls",
  );
  const bar = page.getByTestId("diagnostics-status-bar");
  const navbar = page.locator("header");

  await page.goto(`/projects/${id}/overview`);
  const strictness = bar.locator("select#warning-level");
  await expect(strictness).toBeVisible();
  await expect(navbar.locator("select#warning-level")).toHaveCount(0);

  await page.goto(`/projects/${id}/modeling`);
  const score = bar.getByTitle(/Architecture maturity/);
  await expect(score).toBeVisible();
  await expect(navbar.getByTitle(/Architecture maturity/)).toHaveCount(0);

  // "Far left" / "far right" measured instead of eyeballed — but for the
  // sandwich layout: the toggle is a full-bleed layer *under* the content
  // row, so it spans the bar's whole width (gutters included — a button
  // inside the capped row left them dead), while the badge still starts the
  // content row and the select still ends it, over the toggle rather than
  // beside it. The select keeps its own zone: its wrapper is the one
  // pointer-events-auto hole, so a click on it must not reach the toggle.
  const [barBox, badgeBox, selectBox, toggleBox] = await Promise.all([
    bar.boundingBox(),
    score.boundingBox(),
    strictness.boundingBox(),
    bar.getByRole("button").boundingBox(),
  ]);
  if (!barBox || !badgeBox || !selectBox || !toggleBox) {
    throw new Error("the bar's controls have no bounding boxes");
  }
  // The toggle covers the strip edge to edge…
  expect(toggleBox.x).toBeLessThanOrEqual(barBox.x);
  expect(toggleBox.x + toggleBox.width)
    .toBeGreaterThanOrEqual(barBox.x + barBox.width - 1);
  // …the badge starts the content row (inside the toggle, not left of it)…
  expect(badgeBox.x).toBeGreaterThanOrEqual(toggleBox.x);
  // …and the select ends the row within the bar's own right padding
  // (`lg:px-8` at this viewport), so nothing sits between it and the edge.
  expect(barBox.x + barBox.width - (selectBox.x + selectBox.width))
    .toBeLessThan(40);
  // The select is the toggle's one exclusion: DOM-wise it stays outside the
  // button, so it remains its own control rather than part of the toggle.
  const selectInsideToggle = await bar
    .getByRole("button")
    .locator("select#warning-level")
    .count();
  expect(selectInsideToggle).toBe(0);
});
