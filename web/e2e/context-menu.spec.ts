import { expect, type Locator, type Page, test } from "@playwright/test";

// Right-click context menu on the Modeling canvas: per-target rows with
// shortcut hints, actions reusing the existing handlers.
async function openDiagram(page, name = "E2E context menu") {
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

test("component right-click shows menu; Hide removes from view, keeps model", async ({ page }) => {
  await openDiagram(page);
  await createComponent(page, "e2e-ctx");

  const canvas = page.getByTestId("diagram-canvas");
  const node = canvas.getByText("e2e-ctx").first();
  const box = await node.boundingBox();
  if (!box) throw new Error("created node has no bounding box");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, {
    button: "right",
  });

  const menu = page.getByTestId("context-menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: /hide from this view/i }))
    .toBeVisible();
  await expect(
    menu.getByRole("menuitem", { name: /jump to documentation/i }),
  ).toBeVisible();
  // A brand-new definition has no detail view yet, so the row offers to make
  // one rather than to jump to it.
  await expect(
    menu.getByRole("menuitem", { name: /create a detailed view/i }),
  ).toBeVisible();
  await expect(menu.locator("kbd", { hasText: "H" })).toBeVisible();

  await menu.getByRole("menuitem", { name: /hide from this view/i }).click();
  await expect(menu).toBeHidden();
  await expect(canvas.getByText("e2e-ctx").first()).toBeHidden();

  // View-only removal: the reusable-definition row survives.
  await expect(page.locator('li[title="e2e-ctx"]')).toBeVisible();

  // Undo restores the node on canvas.
  await page.getByTestId("diagram-canvas").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Control+z");
  await expect(canvas.getByText("e2e-ctx").first()).toBeVisible();
});

// The detail-view row is the same row either way — it opens the view if the
// component has one and creates it if not, and says which before you click.
test("the detail-view row creates a view once, then jumps to it", async ({ page }) => {
  const id = await openDiagram(page, "E2E detail view menu");
  await createComponent(page, "e2e-detail");

  const canvas = page.getByTestId("diagram-canvas");
  const menu = page.getByTestId("context-menu");
  const rightClick = async (label: string) => {
    const box = await canvas.getByText(label).first().boundingBox();
    if (!box) throw new Error(`${label} has no bounding box`);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, {
      button: "right",
    });
    await expect(menu).toBeVisible();
  };

  await rightClick("e2e-detail");
  await menu.getByRole("menuitem", { name: /create a detailed view/i }).click();

  // The new view is written, opened, and addressed by its own path.
  await expect(page).toHaveURL(`/projects/${id}/modeling/e2e-detail.hcl`);
  await expect(canvas.getByText("e2e-detail").first()).toBeVisible();
  await expect(page.getByTestId("diagram-system-label")).toContainText(
    "system: main",
  );
  const tree = page.locator("aside").filter({
    has: page.getByRole("heading", { name: "Diagrams" }),
  });
  await expect(
    tree.getByRole("button", { name: "e2e-detail.hcl", exact: true }),
  ).toHaveAttribute("aria-current", "true");

  // The view now exists, so the same row offers to jump instead of create —
  // and jumping is a no-op, because this *is* the component's detail view.
  await rightClick("e2e-detail");
  await expect(
    menu.getByRole("menuitem", { name: /jump to detailed view/i }),
  ).toBeVisible();
  await expect(
    menu.getByRole("menuitem", { name: /create a detailed view/i }),
  ).toHaveCount(0);
  await menu.getByRole("menuitem", { name: /jump to detailed view/i }).click();
  await expect(page).toHaveURL(`/projects/${id}/modeling/e2e-detail.hcl`);
  await expect(canvas.getByText("e2e-detail").first()).toBeVisible();
});

type Rect = { x: number; y: number; width: number; height: number };

async function boxOf(locator: Locator): Promise<Rect> {
  const box = await locator.boundingBox();
  if (!box) throw new Error("element has no bounding box");
  return box;
}

function centerOf(box: Rect) {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function clickAt(page: Page, locator: Locator) {
  const point = centerOf(await boxOf(locator));
  await page.mouse.click(point.x, point.y);
}

// `page.mouse.click` takes no `modifiers`, so shift-click holds the key across
// the click to extend the selection.
async function shiftClickAt(page: Page, locator: Locator) {
  const point = centerOf(await boxOf(locator));
  await page.keyboard.down("Shift");
  await page.mouse.click(point.x, point.y);
  await page.keyboard.up("Shift");
}

async function rightClickAt(page: Page, locator: Locator) {
  const point = centerOf(await boxOf(locator));
  await page.mouse.click(point.x, point.y, { button: "right" });
}

// A component spawned at a spot on the canvas, as a sibling of whatever else
// is there: `C` spawns under the pointer (and only with nothing selected),
// and the click on empty canvas in between is what keeps the next spawn from
// nesting inside the last one.
async function spawnComponentAt(
  page: Page,
  canvas: Locator,
  label: string,
  fx: number,
  fy: number,
) {
  const rect = await boxOf(canvas);
  // Well above the row of nodes, so this click never lands on one.
  await clickAt(page, canvas);
  await page.mouse.move(rect.x + rect.width * fx, rect.y + rect.height * 0.2);
  await page.keyboard.press("c");
  const modal = page.getByTestId("create-component-modal");
  await expect(modal).toBeVisible();
  await modal.locator("#new-comp-name").fill(label);
  await modal.getByRole("button", { name: "Create Definition" }).click();
  await expect(modal).toBeHidden();
  await expect(canvas.getByText(label).first()).toBeVisible();
}

// Canvas (world) coordinates of a locator's center, read off the canvas's own
// viewBox rather than its screen pixels: switching views re-aims the camera,
// so screen positions say nothing about whether a position was carried over.
async function worldCenter(canvas: Locator, locator: Locator) {
  const rect = await boxOf(canvas);
  const box = await boxOf(locator);
  const viewBox = await canvas.getAttribute("viewBox");
  if (!viewBox) throw new Error("canvas has no viewBox");
  const [vx, vy, vw] = viewBox.split(" ").map(Number);
  const zoom = rect.width / vw;
  return {
    x: vx + (centerOf(box).x - rect.x) / zoom,
    y: vy + (centerOf(box).y - rect.y) / zoom,
  };
}

// Three components across the canvas with the first two selected: the third is
// what proves a new view is a copy of the selection, not of the canvas.
async function selectTwoComponents(page: Page, canvas: Locator) {
  await spawnComponentAt(page, canvas, "e2e-pick-a", 0.25, 0.5);
  await spawnComponentAt(page, canvas, "e2e-pick-b", 0.5, 0.5);
  await spawnComponentAt(page, canvas, "e2e-leave-out", 0.75, 0.5);
  await clickAt(page, canvas.getByText("e2e-pick-a").first());
  await shiftClickAt(page, canvas.getByText("e2e-pick-b").first());
}

test("the new-view row copies the selection into a new view and moves there", async ({ page }) => {
  const id = await openDiagram(page, "E2E view from selection");
  const canvas = page.getByTestId("diagram-canvas");
  const menu = page.getByTestId("context-menu");
  const newViewRow = menu.getByRole("menuitem", {
    name: /create new view from selection/i,
  });
  await expect(page).toHaveURL(`/projects/${id}/modeling/main.hcl`);
  await selectTwoComponents(page, canvas);
  const before = {
    a: await worldCenter(canvas, canvas.getByText("e2e-pick-a").first()),
    b: await worldCenter(canvas, canvas.getByText("e2e-pick-b").first()),
  };

  // The prompt is the one dialog this test answers itself, so the fixture's
  // project-name handler (which would accept it with the wrong text) stands
  // down first.
  page.removeAllListeners("dialog");
  page.once("dialog", (dialog) => void dialog.dismiss());

  // Right-clicking a node that is part of the selection keeps the selection,
  // so the row sees both components — not just the one under the pointer.
  await rightClickAt(page, canvas.getByText("e2e-pick-a").first());
  await expect(newViewRow).toBeVisible();
  await newViewRow.click();
  await expect(menu).toBeHidden();

  // A dismissed prompt is a cancel: still on this view, canvas unchanged.
  await expect(page).toHaveURL(`/projects/${id}/modeling/main.hcl`);
  await expect(canvas.getByText("e2e-leave-out").first()).toBeVisible();

  page.once("dialog", (dialog) => void dialog.accept("from-selection"));
  await rightClickAt(page, canvas.getByText("e2e-pick-a").first());
  await newViewRow.click();

  // The Modeling page is now *in* the new view, which the URL names.
  await expect(page).toHaveURL(`/projects/${id}/modeling/from-selection.hcl`);
  await expect(page.getByTestId("diagram-system-label")).toContainText(
    "system: main",
  );
  await expect(
    page.locator("aside").filter({
      has: page.getByRole("heading", { name: "Diagrams" }),
    }).getByRole("button", { name: "from-selection.hcl", exact: true }),
  ).toHaveAttribute("aria-current", "true");

  // The selection came across, at the positions it had here…
  const after = {
    a: await worldCenter(canvas, canvas.getByText("e2e-pick-a").first()),
    b: await worldCenter(canvas, canvas.getByText("e2e-pick-b").first()),
  };
  expect(after.a.x).toBeCloseTo(before.a.x, 0);
  expect(after.a.y).toBeCloseTo(before.a.y, 0);
  expect(after.b.x).toBeCloseTo(before.b.x, 0);
  expect(after.b.y).toBeCloseTo(before.b.y, 0);

  // …and the component that was left unselected did not.
  await expect(canvas.getByText("e2e-pick-a").first()).toBeVisible();
  await expect(canvas.getByText("e2e-pick-b").first()).toBeVisible();
  await expect(canvas.getByText("e2e-leave-out")).toHaveCount(0);
});

test("S does the same from the keyboard", async ({ page }) => {
  const id = await openDiagram(page, "E2E view from selection by keyboard");
  const canvas = page.getByTestId("diagram-canvas");
  await expect(page).toHaveURL(`/projects/${id}/modeling/main.hcl`);
  page.removeAllListeners("dialog");

  // With nothing selected there is no view to cut, so the key must not ask
  // for a name — asserting no prompt at all, since a dismissed one would
  // leave the URL looking exactly as it should.
  let prompted = false;
  page.on("dialog", (dialog) => {
    prompted = true;
    void dialog.dismiss();
  });
  await page.keyboard.press("s");
  expect(prompted).toBe(false);

  await selectTwoComponents(page, canvas);
  page.removeAllListeners("dialog");

  page.once("dialog", (dialog) => void dialog.accept("by-key"));
  await page.keyboard.press("s");

  await expect(page).toHaveURL(`/projects/${id}/modeling/by-key.hcl`);
  await expect(canvas.getByText("e2e-pick-a").first()).toBeVisible();
  await expect(canvas.getByText("e2e-pick-b").first()).toBeVisible();
  await expect(canvas.getByText("e2e-leave-out")).toHaveCount(0);
});

test("an annotation in the selection comes across into the new view", async ({ page }) => {
  const id = await openDiagram(page, "E2E view from selection with note");
  const canvas = page.getByTestId("diagram-canvas");
  const menu = page.getByTestId("context-menu");

  await spawnComponentAt(page, canvas, "e2e-note-a", 0.3, 0.45);
  await spawnComponentAt(page, canvas, "e2e-note-b", 0.55, 0.45);

  // A note well clear of both nodes, so it is unambiguously its own thing.
  const rect = await boxOf(canvas);
  await page.mouse.move(rect.x + rect.width * 0.4, rect.y + rect.height * 0.8);
  await page.keyboard.press("n");
  const note = canvas.getByText("New note").first();
  await expect(note).toBeVisible();

  // Components and a note can be selected together (shift-click each).
  await clickAt(page, canvas.getByText("e2e-note-a").first());
  await shiftClickAt(page, canvas.getByText("e2e-note-b").first());
  await shiftClickAt(page, note);

  // Proof the note really is part of the selection, rather than the row below
  // ignoring something that was never selected: a nudge moves it too. Only
  // "moved", not "moved 10" — snap-to-grid is on, so the first nudge also
  // pulls an off-grid note onto the grid.
  const noteBefore = await boxOf(note);
  await page.keyboard.press("ArrowRight");
  expect((await boxOf(note)).x).not.toBeCloseTo(noteBefore.x, 0);

  page.removeAllListeners("dialog");
  page.once("dialog", (dialog) => void dialog.accept("with-note"));
  await rightClickAt(page, canvas.getByText("e2e-note-a").first());
  await menu.getByRole("menuitem", {
    name: /create new view from selection/i,
  }).click();

  await expect(page).toHaveURL(`/projects/${id}/modeling/with-note.hcl`);
  // The components came across...
  await expect(canvas.getByText("e2e-note-a").first()).toBeVisible();
  await expect(canvas.getByText("e2e-note-b").first()).toBeVisible();
  // ...and so, being part of the selection, the note should have too.
  await expect(note).toBeVisible();
});

test("empty canvas right-click shows canvas menu with shortcuts", async ({ page }) => {
  await openDiagram(page);
  const canvas = page.getByTestId("diagram-canvas");
  // Low on the canvas, clear of the top-anchored floating toolbar — a
  // right-click up there would land on the bar and open no menu.
  await canvas.click({ button: "right", position: { x: 30, y: 300 } });

  const menu = page.getByTestId("context-menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: /new component/i }))
    .toBeVisible();
  await expect(menu.getByRole("menuitem", { name: /new annotation/i }))
    .toBeVisible();
  await expect(menu.getByRole("menuitem", { name: /zoom to fill/i }))
    .toBeVisible();
  await expect(menu.getByRole("menuitem", { name: /reset view/i }))
    .toBeVisible();
  await expect(menu.getByRole("menuitem", { name: /toggle grid/i }))
    .toBeVisible();

  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
});
