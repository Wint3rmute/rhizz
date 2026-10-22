import { expect, test } from "@playwright/test";
import {
  confirmNewConnection,
  createNewProject,
  storedFiles,
  viewFile,
} from "./helpers";

// Hiding a connection removes it from the canvas and unchecks it in the
// sidebar; the state survives reload; unchecking and re-checking an endpoint
// keeps the connection hidden; the sidebar lists exactly the placed
// connections (drawn or hidden).
test("hiding a connection removes it from the canvas and survives reload", async ({
  page,
}) => {
  const id = await createNewProject(page, "E2E connection visibility");

  await page.goto(`/projects/${id}/modeling`);
  await expect(page.getByTestId("diagram-toolbar")).toBeVisible();
  const canvasBox = await page.getByTestId("diagram-canvas").boundingBox();
  if (!canvasBox) throw new Error("no canvas box");
  const emptySpot = {
    x: canvasBox.x + canvasBox.width - 60,
    y: canvasBox.y + canvasBox.height - 60,
  };
  for (const name of ["vis-a", "vis-b", "vis-c"]) {
    await page.mouse.click(emptySpot.x, emptySpot.y);
    await page.getByRole("button", { name: "+ Component" }).click();
    const modal = page.getByTestId("create-component-modal");
    await expect(modal).toBeVisible();
    await modal.locator("#new-comp-name").fill(name);
    await modal.getByRole("button", { name: "Create Definition" }).click();
    await expect(modal).toBeHidden();
  }

  const canvas = page.getByTestId("diagram-canvas");
  const treeRow = (name: string) =>
    page.getByTestId("modeling-pane-right").getByRole("button", { name });

  async function nodeCenter(name: string): Promise<{ x: number; y: number }> {
    const box = await canvas
      .getByText(name, { exact: true })
      .first()
      .boundingBox();
    if (!box) throw new Error(`no box for ${name}`);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }

  const nudges = ["ArrowRight", "ArrowDown", "ArrowLeft"];
  let nudge = 0;
  for (const name of ["vis-a", "vis-b", "vis-c"]) {
    await treeRow(name).click();
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press(nudges[nudge % nudges.length]!);
    }
    nudge++;
  }

  async function dragConnect(
    from: string,
    to: string,
    name: string,
  ): Promise<void> {
    await treeRow(from).click();
    const handle = canvas.getByTestId("diagram-side-handle").first();
    await expect(handle).toBeVisible();
    const handleBox = await handle.boundingBox();
    if (!handleBox) throw new Error(`no handle box for ${from}`);
    const end = await nodeCenter(to);
    await page.mouse.move(
      handleBox.x + handleBox.width / 2,
      handleBox.y + handleBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 8 });
    await page.mouse.up();
    await confirmNewConnection(page, name);
  }

  await dragConnect("vis-a", "vis-b", "link-ab");
  await expect
    .poll(
      async () => {
        const files = await storedFiles(page);
        const model = files["main.hcl"] ?? files["system.hcl"] ?? "";
        return model.includes('connection "link-ab"');
      },
      { timeout: 10_000 },
    )
    .toBe(true);
  // Both connections land on vis-b (the down-nudged node): drops on it hit
  // the canvas, while drops near the top edge can land under the floating
  // toolbar and never start the gesture.
  await dragConnect("vis-c", "vis-b", "link-bc");
  await expect
    .poll(
      async () => {
        const files = await storedFiles(page);
        const model = files["main.hcl"] ?? files["system.hcl"] ?? "";
        return model.includes('connection "link-bc"');
      },
      { timeout: 10_000 },
    )
    .toBe(true);

  // Both connections are drawn and listed, checked.
  await expect(canvas.getByTestId("diagram-edge")).toHaveCount(2);
  const rowAb = page.getByTestId("connection-row-link-ab");
  const rowBc = page.getByTestId("connection-row-link-bc");
  await expect(rowAb).toBeVisible();
  await expect(rowBc).toBeVisible();
  await expect(rowAb.getByRole("checkbox")).toBeChecked();
  await expect(rowBc.getByRole("checkbox")).toBeChecked();

  // Hiding removes it from the canvas and unchecks the sidebar row, and the
  // flag lands in the view file.
  await rowAb.getByRole("checkbox").uncheck();
  await expect(canvas.getByTestId("diagram-edge")).toHaveCount(1);
  await expect(rowAb.getByRole("checkbox")).not.toBeChecked();
  await expect(page.getByTestId("activity-hint")).toHaveText(
    "Connection link-ab hidden",
  );
  await expect(
    page.getByTestId("activity-hint").locator("code.inline-code"),
  ).toHaveText("link-ab");
  await expect
    .poll(async () => viewFile(await storedFiles(page)), { timeout: 10_000 })
    .toMatch(/hidden\s*=\s*true/);

  // Undo restores the edge and the check; redo hides it again — the toggle
  // rides the same layout undo stack as component checkboxes.
  await page.keyboard.press("Control+z");
  await expect(canvas.getByTestId("diagram-edge")).toHaveCount(2);
  await expect(rowAb.getByRole("checkbox")).toBeChecked();
  await page.keyboard.press("Control+y");
  await expect(canvas.getByTestId("diagram-edge")).toHaveCount(1);
  await expect(rowAb.getByRole("checkbox")).not.toBeChecked();

  // The state survives reload.
  await page.reload();
  await expect(page.getByTestId("diagram-toolbar")).toBeVisible();
  const canvasAfter = page.getByTestId("diagram-canvas");
  await expect(canvasAfter.getByTestId("diagram-edge")).toHaveCount(1);
  const rowAbAfter = page.getByTestId("connection-row-link-ab");
  const rowBcAfter = page.getByTestId("connection-row-link-bc");
  await expect(rowAbAfter).toBeVisible();
  await expect(rowBcAfter).toBeVisible();
  await expect(rowAbAfter.getByRole("checkbox")).not.toBeChecked();
  await expect(rowBcAfter.getByRole("checkbox")).toBeChecked();

  // Unchecking and re-checking an endpoint component keeps the connection
  // hidden: the flag survives the component leaving the view.
  const tree = page.getByTestId("modeling-pane-right");
  const visBPlacement = tree
    .locator("li", { hasText: "vis-b" })
    .first()
    .getByRole("checkbox")
    .first();
  await visBPlacement.uncheck();
  // With an endpoint unplaced, neither connection is listed.
  await expect(page.getByTestId("connection-row-link-ab")).toBeHidden();
  await expect(page.getByTestId("connection-row-link-bc")).toBeHidden();
  await visBPlacement.check();
  // Both are listed again; the hidden one stays unchecked.
  await expect(page.getByTestId("connection-row-link-ab")).toBeVisible();
  await expect(page.getByTestId("connection-row-link-bc")).toBeVisible();
  await expect(
    page.getByTestId("connection-row-link-ab").getByRole("checkbox"),
  ).not.toBeChecked();
  await expect(
    page.getByTestId("connection-row-link-bc").getByRole("checkbox"),
  ).toBeChecked();
  await expect(canvasAfter.getByTestId("diagram-edge")).toHaveCount(1);

  // Showing it again redraws the edge and clears the flag from the file.
  await page
    .getByTestId("connection-row-link-ab")
    .getByRole("checkbox")
    .check();
  await expect(canvasAfter.getByTestId("diagram-edge")).toHaveCount(2);
  await expect
    .poll(async () => viewFile(await storedFiles(page)), { timeout: 10_000 })
    .not.toMatch(/hidden\s*=\s*true/);
});

// Delete/Backspace on a selected connection hides it from the view, the same
// way Delete hides a component: the edge leaves the canvas, the row stays
// listed but unchecked, and the connection stays in the model (Code still has
// it). Ctrl+Z brings the edge back.
test("Delete on a selected connection hides it instead of removing it", async ({
  page,
}) => {
  const id = await createNewProject(page, "E2E connection delete hides");

  await page.goto(`/projects/${id}/modeling`);
  await expect(page.getByTestId("diagram-toolbar")).toBeVisible();
  const canvasBox = await page.getByTestId("diagram-canvas").boundingBox();
  if (!canvasBox) throw new Error("no canvas box");
  const emptySpot = {
    x: canvasBox.x + canvasBox.width - 60,
    y: canvasBox.y + canvasBox.height - 60,
  };
  for (const name of ["hide-a", "hide-b"]) {
    await page.mouse.click(emptySpot.x, emptySpot.y);
    await page.getByRole("button", { name: "+ Component" }).click();
    const modal = page.getByTestId("create-component-modal");
    await expect(modal).toBeVisible();
    await modal.locator("#new-comp-name").fill(name);
    await modal.getByRole("button", { name: "Create Definition" }).click();
    await expect(modal).toBeHidden();
  }

  const canvas = page.getByTestId("diagram-canvas");
  const treeRow = (name: string) =>
    page.getByTestId("modeling-pane-right").getByRole("button", { name });

  async function nodeCenter(name: string): Promise<{ x: number; y: number }> {
    const box = await canvas
      .getByText(name, { exact: true })
      .first()
      .boundingBox();
    if (!box) throw new Error(`no box for ${name}`);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }

  // Spread the two components apart so the drag-connect drop lands cleanly.
  await treeRow("hide-a").click();
  for (let i = 0; i < 12; i++) await page.keyboard.press("ArrowRight");
  await treeRow("hide-b").click();
  for (let i = 0; i < 12; i++) await page.keyboard.press("ArrowDown");

  await treeRow("hide-a").click();
  const handle = canvas.getByTestId("diagram-side-handle").first();
  await expect(handle).toBeVisible();
  const handleBox = await handle.boundingBox();
  if (!handleBox) throw new Error("no handle box");
  const end = await nodeCenter("hide-b");
  await page.mouse.move(
    handleBox.x + handleBox.width / 2,
    handleBox.y + handleBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  await confirmNewConnection(page, "link-hide");

  const row = page.getByTestId("connection-row-link-hide");
  await expect(row).toBeVisible();
  await expect(canvas.getByTestId("diagram-edge")).toHaveCount(1);

  // Select the connection by clicking its edge, then press Delete.
  await canvas
    .getByTestId("diagram-edge")
    .first()
    .evaluate((el) =>
      el.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      ),
    );
  await expect(page.getByText("Delete connection")).toBeVisible();
  await page.keyboard.press("Delete");

  // Hidden, not deleted: the edge is gone, the row stays listed unchecked,
  // and the model still declares the connection.
  await expect(canvas.getByTestId("diagram-edge")).toHaveCount(0);
  await expect(row).toBeVisible();
  await expect(row.getByRole("checkbox")).not.toBeChecked();
  await expect
    .poll(async () => viewFile(await storedFiles(page)), { timeout: 10_000 })
    .toMatch(/hidden\s*=\s*true/);
  await expect
    .poll(
      async () => {
        const files = await storedFiles(page);
        const model = files["main.hcl"] ?? files["system.hcl"] ?? "";
        return model.includes('connection "link-hide"');
      },
      { timeout: 10_000 },
    )
    .toBe(true);

  // Undo brings the edge back.
  await page.keyboard.press("Control+z");
  await expect(canvas.getByTestId("diagram-edge")).toHaveCount(1);
  await expect(row.getByRole("checkbox")).toBeChecked();
});
