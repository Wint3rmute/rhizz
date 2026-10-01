import { expect, type Page, test } from "@playwright/test";
import { createFromExample, createNewProject } from "./helpers";

// The two palettes, driven the way a person drives them: the chord, a
// search, and Enter. What they promise is about a live project — which
// files and views exist, and where choosing one lands — so nothing here is
// asserted against fixtures, only against a project this spec opened.

const PALETTE = "command-palette";

// The chord is registered when the project layout mounts its host, which is
// after SvelteKit finishes hydrating — so `page.goto` resolving is not
// enough. The navbar's project links appear in the same render pass as the
// host, so they are the honest gate.
async function gotoProject(
  page: Page,
  id: string,
  path: string,
): Promise<void> {
  await page.goto(`/projects/${id}/${path}`);
  await expect(page.getByRole("link", { name: "Overview" })).toBeVisible();
}

function options(page: Page, text: string) {
  return page.getByTestId(PALETTE).getByTestId("command-palette-option")
    .filter({ hasText: text });
}

test("Ctrl-P switches to a project file from a page that is about neither", async ({ page }) => {
  const id = await createNewProject(page, "E2E palette file");
  await gotoProject(page, id, "overview");

  await page.keyboard.press("Control+p");
  const palette = page.getByTestId(PALETTE);
  await expect(palette).toBeVisible();
  await expect(palette.getByTestId("command-palette-input")).toBeFocused();

  // Off Modeling/Explore the switcher is project-scoped, so it offers the
  // whole project rather than only the views — including the `docs/`
  // placeholder the project store creates.
  await expect(options(page, "main.hcl")).toHaveCount(1);
  await expect(options(page, "docs/")).toHaveCount(1);
  await page.keyboard.type("main");
  await page.keyboard.press("Enter");

  // A file is addressed by its project-relative path, which is what the code
  // page reads off `?file=`.
  await expect(page).toHaveURL(`/projects/${id}/code?file=main.hcl`);
  await expect(palette).toHaveCount(0);
});

test("Ctrl-P narrows to the views when Modeling is the page you are on", async ({ page }) => {
  const id = await createFromExample(
    page,
    /Quadcopter Drone/,
    "E2E palette scope",
  );

  // The whole project, on a page that is about files: the drone example has
  // both a root system.hcl and five views.
  await gotoProject(page, id, "code");
  await page.keyboard.press("Control+p");
  await expect(options(page, "system.hcl")).toHaveCount(1);
  await page.keyboard.press("Escape");

  // Only the views, on a page that draws diagrams.
  await gotoProject(page, id, "modeling");
  await expect(page.getByTestId("diagram-canvas")).toBeVisible();
  await page.keyboard.press("Control+p");
  const rows = page.getByTestId(PALETTE).getByTestId("command-palette-option");
  // Five views, and no root file among them.
  await expect(rows).toHaveCount(5);
  await expect(options(page, "system.hcl")).toHaveCount(0);
});

test("choosing a view switches to it on the view's own path", async ({ page }) => {
  const id = await createFromExample(
    page,
    /Quadcopter Drone/,
    "E2E palette view",
  );

  // From a page that is about files the same row would open the view *as a
  // file*, in Code — the switcher's scope is the page you are on, so this
  // has to start where views are what is on offer.
  await gotoProject(page, id, "explore");
  await page.keyboard.press("Control+p");
  await page.keyboard.type("power");
  await expect(options(page, "power-paths.hcl")).toHaveCount(1);
  // The matched letters are drawn as <mark>, which is the point of the
  // search while typing.
  await expect(
    page.getByTestId(PALETTE).locator("mark").first(),
  ).toHaveText("power");
  await page.keyboard.press("Enter");

  // A view is addressed by its path relative to views/ — exactly what the
  // modeling route's rest param takes.
  await expect(page).toHaveURL(`/projects/${id}/modeling/power-paths.hcl`);
  await expect(page.getByTestId("diagram-canvas")).toBeVisible();
});

test("Ctrl-Shift-P switches page and choosing one navigates", async ({ page }) => {
  const id = await createNewProject(page, "E2E palette command");
  await gotoProject(page, id, "overview");

  await page.keyboard.press("Control+Shift+p");
  const palette = page.getByTestId(PALETTE);
  await expect(palette).toBeVisible();
  await expect(
    palette.getByRole("option", { name: /go to inventory/i }),
  ).toBeVisible();

  await page.keyboard.type("inventory");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(`/projects/${id}/inventory`);
  // Selecting a row closes the palette — otherwise it would still be up on
  // the page it just navigated to.
  await expect(palette).toHaveCount(0);
});

test("Escape closes the palette and leaves the page as it was", async ({ page }) => {
  const id = await createNewProject(page, "E2E palette escape");
  await gotoProject(page, id, "code");
  const url = page.url();

  await page.keyboard.press("Control+p");
  await expect(page.getByTestId(PALETTE)).toBeVisible();
  await page.keyboard.type("main");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId(PALETTE)).toHaveCount(0);
  expect(page.url()).toBe(url);
});

test("the chord opens the palette over the HCL editor too", async ({ page }) => {
  const id = await createNewProject(page, "E2E palette editor");
  await gotoProject(page, id, "code");
  await expect(page.locator(".monaco-editor")).toBeVisible();
  await page.locator(".monaco-editor").click();

  // Monaco binds Ctrl-P to its own quick-open and stops the event bubbling
  // out of the editor, so this only works because the palette takes the
  // chord on the capture phase.
  await page.keyboard.press("Control+p");
  await expect(page.getByTestId(PALETTE)).toBeVisible();
  await expect(page.getByTestId("command-palette-input")).toBeFocused();
  // And the editor did not open its own picker over the top of it.
  await expect(page.locator(".quick-input-widget")).toHaveCount(0);
});

test("the navbar's button opens the command palette", async ({ page }) => {
  const id = await createNewProject(page, "E2E palette button");
  await expect(page.getByRole("link", { name: "Overview" })).toBeVisible();
  await page.getByRole("button", { name: "Open the command palette" }).click();
  await expect(page.getByTestId(PALETTE)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId(PALETTE)).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/projects/${id}/`));
});

test("no project open means no palette", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Rhizz", exact: true }))
    .toBeVisible();
  await page.keyboard.press("Control+p");
  await expect(page.getByTestId(PALETTE)).toHaveCount(0);
  await page.keyboard.press("Control+Shift+p");
  await expect(page.getByTestId(PALETTE)).toHaveCount(0);
});

test("arrow keys move the highlight and wrap around", async ({ page }) => {
  const id = await createNewProject(page, "E2E palette arrows");
  await gotoProject(page, id, "overview");

  await page.keyboard.press("Control+p");
  const rows = page.getByTestId(PALETTE).getByTestId("command-palette-option");
  const count = await rows.count();
  expect(count).toBeGreaterThan(1);

  // The first row starts highlighted, so pressing up from it wraps to the
  // last one rather than to nothing.
  await expect(rows.first()).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowUp");
  await expect(rows.nth(count - 1)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowDown");
  await expect(rows.first()).toHaveAttribute("aria-selected", "true");
});
