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

// A section heading. Exact, and scoped to the palette: "Views" is also the
// start of every `views/*.hcl` row, and "Inventory" is also inside the
// "Go to Inventory" command — a substring match finds six of the wrong ones.
function section(page: Page, name: string) {
  return page.getByTestId(PALETTE).getByText(name, { exact: true });
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
  // Both groups are drawn, so the list reads as "both of these" rather
  // than as one list that happens to contain some files.
  await expect(section(page, "Navigate")).toBeVisible();
  await expect(section(page, "Files")).toBeVisible();
  // And the entities section is not: this is not the inventory page.
  await expect(section(page, "Inventory")).not.toBeVisible();
});

test("Modeling and Explore offer only the diagrams", async ({ page }) => {
  const id = await createFromExample(
    page,
    /Quadcopter Drone/,
    "E2E palette views scope",
  );

  // Both pages draw diagrams, so both answer "which diagram?" — a row for
  // the system file would open text where the user asked for a canvas.
  for (const path of ["modeling/main.hcl", "explore"]) {
    await gotoProject(page, id, path);
    await page.keyboard.press("Control+p");
    // Five views in the drone example, and no root file among them.
    await expect(options(page, "views/")).toHaveCount(5);
    await expect(options(page, "system.hcl")).toHaveCount(0);
    await expect(section(page, "Views")).toBeVisible();
    await page.keyboard.press("Escape");
  }
});

test("Code offers every file", async ({ page }) => {
  const id = await createFromExample(
    page,
    /Quadcopter Drone/,
    "E2E palette files scope",
  );
  await gotoProject(page, id, "code");
  await page.keyboard.press("Control+p");
  // The same project, but now the root file is on offer as well as the
  // views — Code is about files, so it lists all of them.
  await expect(options(page, "system.hcl")).toHaveCount(1);
  await expect(options(page, "views/main.hcl")).toHaveCount(1);
  await expect(section(page, "Files")).toBeVisible();
});

test("Inventory adds the model's definitions, and opens one", async ({ page }) => {
  const id = await createFromExample(
    page,
    /Quadcopter Drone/,
    "E2E palette inventory",
  );
  await gotoProject(page, id, "inventory");
  await expect(
    page.getByTestId("inventory-tree").or(page.locator("aside")).first(),
  )
    .toBeVisible();

  await page.keyboard.press("Control+p");
  const palette = page.getByTestId(PALETTE);
  // A third section, beside the page commands and the files.
  await expect(section(page, "Navigate")).toBeVisible();
  await expect(section(page, "Files")).toBeVisible();
  await expect(section(page, "Inventory")).toBeVisible();
  // The files section is still there alongside it.
  await expect(options(page, "system.hcl")).toHaveCount(1);

  // Searching by a definition's full name finds it — that text is not in
  // the label, only searchable, and drawn as the row's subtitle. The drone
  // example calls it "BMP390 barometric pressure sensor".
  await page.keyboard.type("barometric pressure");
  const row = palette.getByRole("option", { name: /^barometer\b/ });
  await expect(row).toBeVisible();
  await page.keyboard.press("Enter");

  // Choosing one lands on that entity in Inventory, addressed by its label.
  await expect(page).toHaveURL(`/projects/${id}/inventory/barometer`);
  await expect(page.getByTestId(PALETTE)).toHaveCount(0);
});

test("the inventory section appears only on the inventory page", async ({ page }) => {
  const id = await createFromExample(
    page,
    /Quadcopter Drone/,
    "E2E palette inventory scope",
  );
  // The drone example declares 13 definitions; they are only ever offered
  // where they can actually be opened.
  for (const path of ["overview", "code", "modeling/main.hcl"]) {
    await gotoProject(page, id, path);
    await page.keyboard.press("Control+p");
    await expect(section(page, "Inventory")).not.toBeVisible();
    await expect(options(page, "battery")).toHaveCount(0);
    await page.keyboard.press("Escape");
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

test("opening the palette does not move the browser's own colour", async ({ page }) => {
  const id = await createNewProject(page, "E2E palette chrome");
  await gotoProject(page, id, "code");
  await expect(page.locator(".monaco-editor")).toBeVisible();

  // The browser paints its toolbar from `<meta name="theme-color">`. Without
  // one it infers the colour from painted content and re-infers on every
  // repaint, so opening a full-viewport dialog visibly shifts it. Asserted
  // through <html>'s reported background, which is what that inference moves.
  const themeColor = await page.evaluate(() =>
    document.querySelector('meta[name="theme-color"]')?.getAttribute("content")
  );
  expect(themeColor, "theme-color meta is present").toMatch(/^#[0-9A-F]{6}$/i);

  const rootBackground = () =>
    page.evaluate(() =>
      getComputedStyle(document.documentElement).backgroundColor
    );

  const closed = await rootBackground();
  await page.keyboard.press("Control+p");
  await expect(page.getByTestId(PALETTE)).toBeVisible();
  await page.waitForTimeout(500);
  const open = await rootBackground();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId(PALETTE)).toHaveCount(0);

  expect(open, "root background must not repaint on open").toBe(closed);
});

test("the toolbar colour follows the theme", async ({ page }) => {
  await page.goto("/");
  // The navbar renders the toggle a beat after load, and it is the same
  // render pass that applies the theme — so wait for it before reading the
  // colour it produced, or this reads the static default instead.
  const toggle = page.getByTitle(/toggle light\/dark theme/i);
  await expect(toggle).toBeVisible();

  const applied = () =>
    page.evaluate(() => ({
      theme: document.documentElement.dataset.theme ?? null,
      chrome: document
        .querySelector('meta[name="theme-color"]')
        ?.getAttribute("content") ?? null,
    }));

  const start = await applied();
  expect(start.chrome).toBe(start.theme === "dark" ? "#1D232A" : "#FFFFFF");

  // Toggling pins the opposite theme, and the toolbar colour has to follow
  // it — a toolbar stuck on the other theme's colour is the same class of
  // bug as one that jumps.
  await toggle.click();
  await expect
    .poll(async () => (await applied()).theme)
    .not.toBe(start.theme);
  const after = await applied();
  expect(after.chrome).toBe(after.theme === "dark" ? "#1D232A" : "#FFFFFF");
  expect(after.chrome).not.toBe(start.chrome);
});
