import { expect, type Page, test } from "@playwright/test";

// Modeling's left panel (Inspector + diagram picker) is a modular Pane:
// it hides behind its header button (leaving a full-bar restore rail),
// drag-resizes via its splitter, and the arrangement persists across
// reloads. Each test gets a fresh browser context (fresh localStorage),
// so every test opens the default layout.
async function openModeling(page: Page, name: string) {
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
  await expect(page.getByTestId("diagram-canvas")).toBeVisible();
}

async function paneWidth(page: Page, testId: string): Promise<number> {
  const box = await page.getByTestId(testId).boundingBox();
  if (!box) throw new Error(`${testId} should be laid out`);
  return box.width;
}

test("modeling puts the inspector panel beside the canvas", async ({ page }) => {
  await openModeling(page, "E2E modeling panes");

  const panel = page.getByTestId("modeling-pane-left");
  const canvas = page.getByTestId("diagram-canvas");
  await expect(panel).toBeVisible();
  await expect(canvas).toBeVisible();

  const panelBox = await panel.boundingBox();
  const canvasBox = await canvas.boundingBox();
  if (!panelBox || !canvasBox) {
    throw new Error("panel and canvas should be laid out");
  }

  // Beside, not below: the canvas starts where the panel ends, sharing a
  // vertical band. The 1px slack absorbs sub-pixel rounding.
  expect(canvasBox.x).toBeGreaterThanOrEqual(
    panelBox.x + panelBox.width - 1,
  );
  expect(canvasBox.y).toBeLessThan(panelBox.y + panelBox.height);

  // Default width matches the old fixed sidebar (w-64).
  expect(panelBox.width).toBeGreaterThanOrEqual(255);
  expect(panelBox.width).toBeLessThanOrEqual(257);
});

test("modeling hides and restores the inspector without unmounting it", async ({ page }) => {
  await openModeling(page, "E2E modeling hide");

  await page.getByRole("button", { name: "Hide Inspector" }).click();
  await expect(page.getByTestId("modeling-pane-left")).toBeHidden();
  const rail = page.getByTestId("modeling-pane-rail-left");
  await expect(rail).toBeVisible();
  await expect(rail).toHaveCSS("cursor", "pointer");
  await expect(page.getByTestId("modeling-splitter-left")).toBeHidden();

  // The whole rail expands — click its corner, far from the chevron.
  await rail.click({ position: { x: 2, y: 2 } });
  await expect(page.getByTestId("modeling-pane-left")).toBeVisible();
});

test("modeling resizes the inspector by dragging its splitter", async ({ page }) => {
  await openModeling(page, "E2E modeling resize");

  const before = await paneWidth(page, "modeling-pane-left");
  const splitter = page.getByTestId("modeling-splitter-left");
  const box = await splitter.boundingBox();
  if (!box) throw new Error("the splitter should be laid out");

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2, {
    steps: 5,
  });
  await page.mouse.up();

  const grown = await paneWidth(page, "modeling-pane-left");
  expect(grown).toBeGreaterThan(before + 80);

  // Dragging far past the edge clamps instead of collapsing or exploding.
  const grownBox = await splitter.boundingBox();
  if (!grownBox) throw new Error("the splitter should be laid out");
  await page.mouse.move(
    grownBox.x + grownBox.width / 2,
    grownBox.y + grownBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(-100, grownBox.y + grownBox.height / 2, { steps: 5 });
  await page.mouse.up();

  const clamped = await paneWidth(page, "modeling-pane-left");
  expect(clamped).toBeGreaterThanOrEqual(199);
  expect(clamped).toBeLessThanOrEqual(201);
});

test("modeling remembers a hidden inspector across reloads", async ({ page }) => {
  await openModeling(page, "E2E modeling persist");

  await page.getByRole("button", { name: "Hide Inspector" }).click();
  await expect(page.getByTestId("modeling-pane-left")).toBeHidden();

  await page.reload();
  await expect(page.getByTestId("diagram-canvas")).toBeVisible();
  await expect(page.getByTestId("modeling-pane-left")).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Show Inspector" }),
  ).toBeVisible();
});

test("modeling hides and restores the components panel", async ({ page }) => {
  await openModeling(page, "E2E modeling components hide");

  const panel = page.getByTestId("modeling-pane-right");
  await expect(panel).toBeVisible();

  await page.getByRole("button", { name: "Hide Components" }).click();
  await expect(panel).toBeHidden();
  const rail = page.getByTestId("modeling-pane-rail-right");
  await expect(rail).toBeVisible();
  await expect(rail).toHaveCSS("cursor", "pointer");
  await expect(page.getByTestId("modeling-splitter-right")).toBeHidden();

  await rail.click({ position: { x: 2, y: 2 } });
  await expect(panel).toBeVisible();
  // The tree is back, still bound to the open view's system.
  await expect(page.getByTestId("diagram-system-label")).toContainText(
    "system: main",
  );
});

test("modeling resizes the components panel by dragging its splitter", async ({ page }) => {
  await openModeling(page, "E2E modeling components resize");

  const before = await paneWidth(page, "modeling-pane-right");
  const splitter = page.getByTestId("modeling-splitter-right");
  const box = await splitter.boundingBox();
  if (!box) throw new Error("the splitter should be laid out");

  // Dragging left widens the right panel (mirrored sign of the left one).
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 100, box.y + box.height / 2, {
    steps: 5,
  });
  await page.mouse.up();

  const grown = await paneWidth(page, "modeling-pane-right");
  expect(grown).toBeGreaterThan(before + 80);
});
