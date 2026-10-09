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

test("Inventory offers the pages and the definitions, and opens one", async ({ page }) => {
  const id = await createFromExample(
    page,
    /Quadcopter Drone/,
    "E2E palette inventory",
  );
  await gotoProject(page, id, "inventory");
  // Gate on the browser panel: the page is settled once it is visible.
  await expect(page.getByTestId("inventory-pane-left")).toBeVisible();

  await page.keyboard.press("Control+p");
  const palette = page.getByTestId(PALETTE);
  // Two sections, not three: the pages and the definitions. The page is
  // about entities, and a file row would be a third thing to search that
  // lands the user on some other page entirely.
  await expect(section(page, "Navigate")).toBeVisible();
  await expect(section(page, "Inventory")).toBeVisible();
  await expect(section(page, "Files")).not.toBeVisible();
  // So no file is on offer there — not the system model, not the views, not
  // the docs. They are all still one chord away on the pages that are about
  // them.
  await expect(options(page, "system.hcl")).toHaveCount(0);
  await expect(options(page, "views/")).toHaveCount(0);
  await expect(options(page, "docs/")).toHaveCount(0);

  // Searching by a definition's full name finds it — that text is not in
  // the label, only searchable, and drawn as the row's subtitle. The drone
  // example calls it "BMP390 barometric pressure sensor".
  await page.keyboard.type("barometric pressure");
  const row = palette.getByRole("option", {
    name: /^go to component barometer\b/i,
  });
  await expect(row).toBeVisible();
  await page.keyboard.press("Enter");

  // Choosing one lands on that entity in Inventory, addressed by its label.
  await expect(page).toHaveURL(`/projects/${id}/inventory/barometer`);
  await expect(page.getByTestId(PALETTE)).toHaveCount(0);
});

test("Inventory offers Go to system rows, and one opens the system", async ({ page }) => {
  const id = await createFromExample(
    page,
    /Quadcopter Drone/,
    "E2E palette inventory systems",
  );
  await gotoProject(page, id, "inventory");

  await page.keyboard.press("Control+p");
  const palette = page.getByTestId(PALETTE);
  // The drone example declares two systems alongside its definitions.
  const row = palette.getByRole("option", {
    name: /^go to system quadcopter\b/i,
  });
  await expect(row).toBeVisible();
  await row.click();

  // Choosing one lands on that system in Inventory — addressed by its
  // label, with the Systems tab holding the open row.
  await expect(page).toHaveURL(`/projects/${id}/inventory/quadcopter`);
  await expect(
    page.getByRole("tab", { name: "Systems" }),
  ).toHaveAttribute("aria-selected", "true");
});

test("searching on Inventory never surfaces a file", async ({ page }) => {
  // The software-house example is the one that has docs/: every one of its 12
  // top-level components ships a `docs/<label>.md`, so it is where a doc row
  // used to answer a search that was really asking for a component.
  const id = await createFromExample(
    page,
    /Software House/,
    "E2E palette inventory no files",
  );
  await gotoProject(page, id, "inventory");

  await page.keyboard.press("Control+p");
  const palette = page.getByTestId(PALETTE);
  await expect(palette).toBeVisible();
  // Neither kind of file is on offer, so neither heading is drawn.
  await expect(section(page, "Files")).not.toBeVisible();
  await expect(options(page, "docs/")).toHaveCount(0);
  await expect(options(page, "views/")).toHaveCount(0);

  const input = page.getByTestId("command-palette-input");
  // A component label, a view file and a doc file, typed one after the other.
  // Each used to answer with file rows alongside the component; now the
  // component answers alone and the files answer with nothing at all.
  for (const query of ["automation-qa", "org-chart", "platform-team.md"]) {
    await input.fill(query);
    await expect(
      options(page, ".hcl"),
      `${query} must not match a view row on Inventory`,
    ).toHaveCount(0);
    await expect(
      options(page, ".md"),
      `${query} must not match a doc row on Inventory`,
    ).toHaveCount(0);
  }

  // And the component row is still there, found by the same query — the
  // palette is narrower, not broken.
  await input.fill("automation-qa");
  await expect(
    palette.getByRole("option", { name: /^go to component automation-qa\b/i }),
  ).toBeVisible();

  // The pages are still on offer too, and one of them opens.
  await input.fill("overview");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(`/projects/${id}/overview`);
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

test("a component row draws the component's own icon", async ({ page }) => {
  // All 12 top-level definitions of this example declare an icon, so the count
  // is the whole claim: every definition row came out of the model carrying a
  // glyph. That is the part a unit test cannot reach — the name has to
  // survive the compiler, the JSON payload and the row builder before there is
  // anything to draw.
  const id = await createFromExample(
    page,
    /Software House/,
    "E2E palette component icons",
  );
  await gotoProject(page, id, "inventory");

  await page.keyboard.press("Control+p");
  const rows = page.getByTestId(PALETTE).getByTestId("command-palette-option");
  // The definitions, and only the definitions: the page commands carry emoji
  // (drawn as text, not as an <svg>), so a glyph count that included them
  // would be measuring the wrong thing.
  const components = rows.filter({ hasText: "Go to component" });
  await expect(components).toHaveCount(12);
  await expect(components.locator("svg")).toHaveCount(12);

  // The emoji rows are untouched by this — still a character of text in the
  // same slot, so the two kinds of row read as one list. The commands come
  // first (see the CommandsComeFirst story), so the first row is one.
  await expect(rows.first()).toContainText("Go to Overview");
  await expect(rows.first().locator("svg")).toHaveCount(0);

  // And an icon is decoration, not content: the row is still found, and still
  // named, by the words on it.
  await expect(options(page, "Go to component automation-qa")).toHaveCount(1);
});

test("two words with a gap between them still find the component", async ({ page }) => {
  // The reported failure. A query can be two words the user actually reaches
  // for and still not be a substring of the label, because the label carries
  // a prefix the query skips — and the search scores a match partly on *where*
  // in the label it starts, so a match that cannot begin at the first
  // character is scored against noise it should beat. The software-house
  // example has the rows for it: "platform-team" and "product-managers" are
  // two words each, and neither pair of words is what the label spells.
  const id = await createFromExample(
    page,
    /Software House/,
    "E2E palette gapped query",
  );
  await gotoProject(page, id, "inventory");

  await page.keyboard.press("Control+p");
  const palette = page.getByTestId(PALETTE);
  const input = page.getByTestId("command-palette-input");

  for (
    const [query, component] of [
      ["plat team", "platform-team"],
      ["prod mgr", "product-managers"],
      ["front team", "frontend-team"],
    ]
  ) {
    await input.fill(query);
    await expect(
      options(page, `Go to component ${component}`),
      `${query} must find ${component}`,
    ).toHaveCount(1);
    // Exactly the query's own characters are marked, in order — the highlight
    // is the only account the user gets of why the row matched, so what the
    // query skipped must not be in it. How many separate runs that takes
    // depends on how gapped the words are: "mgr" jumps over "an" and "e", so
    // it marks three runs on its own.
    const marked = await palette.locator("mark").allTextContents();
    expect(marked.join(""), `${query} highlights only its own characters`)
      .toBe(query.replaceAll(" ", ""));
  }

  // And the words still have to be there: this rescues a query the search
  // could not place, it does not return the whole project.
  await input.fill("plat team zzz");
  await expect(options(page, "Go to component")).toHaveCount(0);

  // A rescued match is a real match — choosing it still navigates.
  await input.fill("plat team");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(`/projects/${id}/inventory/platform-team`);
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
