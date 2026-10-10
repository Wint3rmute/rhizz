import { expect, test } from "@playwright/test";

// Inventory's modular workspace: a browser panel on the left, the diagram
// preview in the centre, and the details panel on the right. Panels resize
// by dragging the splitter beside them, hide behind a header button (leaving
// a slim restore rail), and the whole arrangement persists across reloads.
//
// Playwright runs at its 1280px default, which is above the `md` breakpoint
// the side-by-side arrangement needs. Each test gets a fresh browser context
// (fresh localStorage), so every test opens the default layout.
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

async function paneWidth(page, testId: string): Promise<number> {
  const box = await page.getByTestId(testId).boundingBox();
  if (!box) throw new Error(`${testId} should be laid out`);
  return box.width;
}

test("inventory puts both panels beside the diagram preview", async ({ page }) => {
  await openInventory(page, "E2E inventory panes");

  const left = page.getByTestId("inventory-pane-left");
  const diagram = page.getByTestId("inventory-diagram");
  const right = page.getByTestId("inventory-pane-right");
  await expect(left).toBeVisible();
  await expect(diagram).toBeVisible();
  await expect(right).toBeVisible();

  const leftBox = await left.boundingBox();
  const chart = await diagram.boundingBox();
  const rightBox = await right.boundingBox();
  if (!leftBox || !chart || !rightBox) {
    throw new Error("all three regions should be laid out");
  }

  // Beside, not below: the diagram starts where the left panel ends and the
  // right panel starts where the diagram ends, all sharing a vertical band.
  // The 1px slack absorbs sub-pixel rounding of the flex split.
  expect(chart.x).toBeGreaterThanOrEqual(leftBox.x + leftBox.width - 1);
  expect(rightBox.x).toBeGreaterThanOrEqual(chart.x + chart.width - 1);
  expect(chart.y).toBeLessThan(leftBox.y + leftBox.height);
  expect(rightBox.y).toBeLessThan(chart.y + chart.height);

  // Default widths: the browser opens at 320px, details at 384px.
  expect(leftBox.width).toBeGreaterThanOrEqual(319);
  expect(leftBox.width).toBeLessThanOrEqual(321);
  expect(rightBox.width).toBeGreaterThanOrEqual(383);
  expect(rightBox.width).toBeLessThanOrEqual(385);
});

test("inventory hides and restores each panel without unmounting it", async ({ page }) => {
  await openInventory(page, "E2E inventory hide");

  const search = page.getByLabel("Search inventory");
  await search.fill("battery");
  await expect(search).toHaveValue("battery");

  await page.getByRole("button", { name: "Hide Inventory Browser" }).click();
  await expect(page.getByTestId("inventory-pane-left")).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Show Inventory Browser" }),
  ).toBeVisible();
  // The splitter goes with its panel — there is nothing to resize.
  await expect(page.getByTestId("inventory-splitter-left")).toBeHidden();

  await page.getByRole("button", { name: "Show Inventory Browser" }).click();
  const restored = page.getByLabel("Search inventory");
  await expect(restored).toBeVisible();
  // Hidden, never unmounted: the typed filter is still there.
  await expect(restored).toHaveValue("battery");

  await page.getByRole("button", { name: "Hide Details" }).click();
  await expect(page.getByTestId("inventory-pane-right")).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Show Details" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Show Details" }).click();
  await expect(page.getByTestId("inventory-pane-right")).toBeVisible();
  await expect(page.getByTestId("inventory-detail-pane")).toBeVisible();
});

test("inventory resizes panels by dragging their splitter", async ({ page }) => {
  await openInventory(page, "E2E inventory resize");

  const before = await paneWidth(page, "inventory-pane-left");
  const splitter = page.getByTestId("inventory-splitter-left");
  const box = await splitter.boundingBox();
  if (!box) throw new Error("the splitter should be laid out");

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2, {
    steps: 5,
  });
  await page.mouse.up();

  const grown = await paneWidth(page, "inventory-pane-left");
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

  const clamped = await paneWidth(page, "inventory-pane-left");
  expect(clamped).toBeGreaterThanOrEqual(199);
  expect(clamped).toBeLessThanOrEqual(201);
});

test("inventory splitter answers the keyboard", async ({ page }) => {
  await openInventory(page, "E2E inventory splitter keys");

  const before = await paneWidth(page, "inventory-pane-right");
  const splitter = page.getByRole("slider", {
    name: "Resize details panel",
  });
  await splitter.focus();
  await page.keyboard.press("ArrowLeft");
  const after = await paneWidth(page, "inventory-pane-right");
  // ArrowLeft moves the separator left, which widens the right panel.
  expect(after).toBeGreaterThan(before);
});

test("inventory restore rails expand on any click and show a pointer", async ({ page }) => {
  await openInventory(page, "E2E inventory rail");

  await page.getByRole("button", { name: "Hide Inventory Browser" }).click();
  const rail = page.getByTestId("inventory-pane-rail-left");
  await expect(rail).toBeVisible();
  await expect(rail).toHaveCSS("cursor", "pointer");

  // Click the rail's corner, far from the chevron: the whole bar expands,
  // so no precise aiming is needed.
  await rail.click({ position: { x: 2, y: 2 } });
  await expect(page.getByTestId("inventory-pane-left")).toBeVisible();
});

test("inventory panels stop at a share of the viewport width", async ({ page }) => {
  await openInventory(page, "E2E inventory viewport cap");
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("page has no viewport size");
  const expected = viewport.width * 0.4;

  // Drag far past the edge: the 40%-of-viewport cap binds before the
  // absolute px ceiling does.
  const splitter = page.getByTestId("inventory-splitter-left");
  const box = await splitter.boundingBox();
  if (!box) throw new Error("the splitter should be laid out");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(viewport.width - 10, box.y + box.height / 2, {
    steps: 10,
  });
  await page.mouse.up();

  const width = await paneWidth(page, "inventory-pane-left");
  expect(width).toBeGreaterThanOrEqual(expected - 1);
  expect(width).toBeLessThanOrEqual(expected + 1);
});

test("inventory remembers hidden panels across reloads", async ({ page }) => {
  await openInventory(page, "E2E inventory persist");

  await page.getByRole("button", { name: "Hide Inventory Browser" }).click();
  await expect(page.getByTestId("inventory-pane-left")).toBeHidden();

  await page.reload();
  await expect(page.getByTestId("inventory-pane-left")).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Show Inventory Browser" }),
  ).toBeVisible();
  // The other panel is untouched by the reload.
  await expect(page.getByTestId("inventory-pane-right")).toBeVisible();
});
