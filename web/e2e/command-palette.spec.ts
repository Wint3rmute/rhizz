import { expect, type Page, test } from "@playwright/test";
import { createFromExample, createNewProject } from "./helpers";

// The palette, driven the way a person drives it: the chord, a search, and
// Enter. What it promises is about a live project — which files and views
// exist, and where choosing one lands — so nothing here is asserted against
// fixtures, only against a project this spec opened.

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

test("Ctrl-P offers the commands and the files in one list", async ({ page }) => {
  const id = await createFromExample(
    page,
    /Quadcopter Drone/,
    "E2E palette one list",
  );
  await gotoProject(page, id, "overview");

  await page.keyboard.press("Control+p");
  const palette = page.getByTestId(PALETTE);
  await expect(palette).toBeVisible();
  await expect(palette.getByTestId("command-palette-input")).toBeFocused();

  // One search box, both kinds of row — no chord to choose between.
  await expect(
    palette.getByRole("option", { name: /go to inventory/i }),
  ).toBeVisible();
  await expect(options(page, "system.hcl")).toHaveCount(1);
  await expect(options(page, "views/main.hcl")).toHaveCount(1);
  // Exact, because the footer carries an "↑↓ navigate" hint too.
  await expect(
    palette.getByText("Navigate", { exact: true }),
  ).toBeVisible();
  await expect(palette.getByText("Files", { exact: true })).toBeVisible();
});

test("the same rows are offered on every page", async ({ page }) => {
  const id = await createFromExample(
    page,
    /Quadcopter Drone/,
    "E2E palette everywhere",
  );

  // What the palette offers does not depend on which page summoned it: one
  // chord, one list, the whole project from anywhere. This used to narrow to
  // views on Modeling/Explore, which meant the same key offered different
  // things depending on where you were standing.
  for (const path of ["code", "modeling/main.hcl", "explore", "inventory"]) {
    await gotoProject(page, id, path);
    await page.keyboard.press("Control+p");
    await expect(options(page, "system.hcl")).toHaveCount(1);
    await expect(options(page, "views/main.hcl")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId(PALETTE)).toHaveCount(0);
  }
});

test("choosing a file opens it in the editor", async ({ page }) => {
  const id = await createNewProject(page, "E2E palette file");
  await gotoProject(page, id, "overview");

  await page.keyboard.press("Control+p");
  await page.keyboard.type("main");
  await page.keyboard.press("Enter");

  // A file is addressed by its project-relative path, which is what the code
  // page reads off `?file=`.
  await expect(page).toHaveURL(`/projects/${id}/code?file=main.hcl`);
  await expect(page.getByTestId(PALETTE)).toHaveCount(0);
});

test("choosing a view opens the canvas, not the text", async ({ page }) => {
  const id = await createFromExample(
    page,
    /Quadcopter Drone/,
    "E2E palette view",
  );
  await gotoProject(page, id, "overview");

  await page.keyboard.press("Control+p");
  await page.keyboard.type("power");
  // The view is found by its project path, the same as any other file.
  await expect(options(page, "power-paths.hcl")).toHaveCount(1);
  // The matched letters are drawn as <mark>, which is the point of the
  // search while typing.
  await expect(
    page.getByTestId(PALETTE).locator("mark").first(),
  ).toHaveText("power");
  await page.keyboard.press("Enter");

  // But it opens where a diagram belongs, addressed by its path within
  // views/ — exactly what the modeling route's rest param takes.
  await expect(page).toHaveURL(`/projects/${id}/modeling/power-paths.hcl`);
  await expect(page.getByTestId("diagram-canvas")).toBeVisible();
});

test("choosing a command switches page", async ({ page }) => {
  const id = await createNewProject(page, "E2E palette command");
  await gotoProject(page, id, "overview");

  await page.keyboard.press("Control+p");
  const palette = page.getByTestId(PALETTE);
  await expect(palette).toBeVisible();

  await page.keyboard.type("inventory");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(`/projects/${id}/inventory`);
  // Selecting a row closes the palette — otherwise it would still be up on
  // the page it just navigated to.
  await expect(palette).toHaveCount(0);
});

test("Ctrl-Shift-P no longer opens a palette", async ({ page }) => {
  const id = await createNewProject(page, "E2E palette shift");
  await gotoProject(page, id, "overview");
  // There is one palette now, so nothing else may claim a second chord:
  // Ctrl-Shift-P is left to the browser.
  await page.keyboard.press("Control+Shift+p");
  await expect(page.getByTestId(PALETTE)).toHaveCount(0);
  await page.keyboard.press("Control+p");
  await expect(page.getByTestId(PALETTE)).toBeVisible();
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

test("the navbar's button opens the palette", async ({ page }) => {
  const id = await createNewProject(page, "E2E palette button");
  await expect(page.getByRole("link", { name: "Overview" })).toBeVisible();
  await page.getByRole("button", { name: "Open the go-to palette" }).click();
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
