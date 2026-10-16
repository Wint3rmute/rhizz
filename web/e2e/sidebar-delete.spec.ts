import { expect, type Page, test } from "@playwright/test";
import { createNewProject, storedFiles } from "./helpers";

// The Components and Connections sidebars of Modeling each carry a trash
// button on hover. Clicking it removes the item from the system model (not
// just the view) after a confirm dialog. Cancelling leaves everything alone.

async function modelText(page: Page): Promise<string> {
  const files = await storedFiles(page);
  return files["main.hcl"] ?? files["system.hcl"] ?? "";
}

async function openModeling(page: Page, name: string): Promise<string> {
  const id = await createNewProject(page, name);
  await page.goto(`/projects/${id}/modeling`);
  await expect(page.getByTestId("diagram-toolbar")).toBeVisible();
  await expect(page.getByTestId("diagram-canvas")).toBeVisible();
  return id;
}

async function createComponent(page: Page, label: string): Promise<void> {
  await page.getByRole("button", { name: "+ Component" }).click();
  const modal = page.getByTestId("create-component-modal");
  await expect(modal).toBeVisible();
  await modal.locator("#new-comp-name").fill(label);
  await modal.getByRole("button", { name: "Create Definition" }).click();
  await expect(modal).toBeHidden();
}

test("trash on a component row removes the instance from the model after confirm", async ({
  page,
}) => {
  await openModeling(page, "E2E sidebar delete component");
  await createComponent(page, "trash-a");

  const tree = page.getByTestId("modeling-pane-right");
  const row = tree.locator("li", { hasText: "trash-a" }).first();
  await expect(row).toBeVisible();
  await expect
    .poll(async () => (await modelText(page)).includes('instance "trash-a"'), {
      timeout: 10_000,
    })
    .toBe(true);

  // Cancel: nothing is removed.
  page.once("dialog", (dialog) => void dialog.dismiss());
  await row.hover();
  await row.getByRole("button", { name: "Delete component trash-a" }).click();
  await expect(row).toBeVisible();
  expect(await modelText(page)).toContain('instance "trash-a"');

  // Confirm: the instance leaves the model and the row disappears.
  page.once("dialog", (dialog) => void dialog.accept());
  await row.hover();
  await row.getByRole("button", { name: "Delete component trash-a" }).click();
  await expect(row).toBeHidden();
  await expect
    .poll(async () => (await modelText(page)).includes('instance "trash-a"'), {
      timeout: 10_000,
    })
    .toBe(false);
});

test("trash on a connection row removes the connection from the model after confirm", async ({
  page,
}) => {
  await openModeling(page, "E2E sidebar delete connection");
  const canvas = page.getByTestId("diagram-canvas");
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) throw new Error("no canvas box");
  const emptySpot = {
    x: canvasBox.x + canvasBox.width - 60,
    y: canvasBox.y + canvasBox.height - 60,
  };
  for (const name of ["trash-b", "trash-c"]) {
    await page.mouse.click(emptySpot.x, emptySpot.y);
    await createComponent(page, name);
  }

  const tree = page.getByTestId("modeling-pane-right");
  const treeRow = (name: string) => tree.getByRole("button", { name });

  async function nodeCenter(name: string): Promise<{ x: number; y: number }> {
    const box = await canvas
      .getByText(name, { exact: true })
      .first()
      .boundingBox();
    if (!box) throw new Error(`no box for ${name}`);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }

  // Spread the two nodes apart so the drag-connect drop lands cleanly.
  await treeRow("trash-b").click();
  for (let i = 0; i < 12; i++) await page.keyboard.press("ArrowRight");
  await treeRow("trash-c").click();
  for (let i = 0; i < 12; i++) await page.keyboard.press("ArrowDown");

  page.once("dialog", (dialog) => void dialog.accept("link-trash"));
  await treeRow("trash-b").click();
  const handle = canvas.getByTestId("diagram-side-handle").first();
  await expect(handle).toBeVisible();
  const handleBox = await handle.boundingBox();
  if (!handleBox) throw new Error("no handle box");
  const end = await nodeCenter("trash-c");
  await page.mouse.move(
    handleBox.x + handleBox.width / 2,
    handleBox.y + handleBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();

  const row = page.getByTestId("connection-row-link-trash");
  await expect(row).toBeVisible();
  await expect
    .poll(
      async () => (await modelText(page)).includes('connection "link-trash"'),
      {
        timeout: 10_000,
      },
    )
    .toBe(true);

  // Cancel: the connection stays.
  page.once("dialog", (dialog) => void dialog.dismiss());
  await row.hover();
  await row
    .getByRole("button", { name: "Delete connection link-trash" })
    .click();
  await expect(row).toBeVisible();
  expect(await modelText(page)).toContain('connection "link-trash"');

  // Confirm: the connection leaves the model and its row disappears.
  page.once("dialog", (dialog) => void dialog.accept());
  await row.hover();
  await row
    .getByRole("button", { name: "Delete connection link-trash" })
    .click();
  await expect(row).toBeHidden();
  await expect
    .poll(
      async () => (await modelText(page)).includes('connection "link-trash"'),
      {
        timeout: 10_000,
      },
    )
    .toBe(false);
});
