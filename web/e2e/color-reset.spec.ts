import { expect, test } from "@playwright/test";

// Inspector color reset: setting a color and then back to "None" must clear
// the node's stroke to the default base-content grey. Regression test —
// "None" used to leave the previously selected color stuck on the node.
async function openDiagram(page, name = "E2E color reset") {
  await page.goto("/");
  const create = page.getByRole("button", { name: "New project" }).first();
  await expect(create).toBeVisible();
  page.on("dialog", (dialog) => void dialog.accept(name));
  await create.click();
  // Fresh projects auto-open the guided tour, which routes to the
  // overview — either landing proves creation. Silence the tour before
  // continuing: its backdrop would blanket the canvas under test.
  await expect(page).toHaveURL(/\/projects\/.+\/(code|overview)/);
  const tourDialog = page.getByRole("alertdialog");
  await expect(tourDialog).toBeVisible();
  await tourDialog.getByRole("button", { name: "skip tour" }).click();
  await expect(tourDialog).toBeHidden();
  const id = new URL(page.url()).pathname.split("/")[2];
  await page.goto(`/projects/${id}/modeling`);
  await expect(page.getByTestId("diagram-toolbar")).toBeVisible();
  await expect(page.getByTestId("diagram-canvas")).toBeVisible();
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

test("resetting color to Default clears the warning stroke", async ({ page }) => {
  await openDiagram(page);
  await createComponent(page, "e2e-color");

  const canvas = page.getByTestId("diagram-canvas");
  const node = canvas.getByText("e2e-color").first();
  const box = await node.boundingBox();
  if (!box) throw new Error("created node has no bounding box");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByTestId("node-inspector")).toBeVisible();

  const colorSelect = page.locator("#comp-color-input");
  const warningStroke = 'rect[stroke="var(--color-warning)"]';
  const defaultStroke = 'rect[stroke="var(--color-base-content)"]';

  // Fresh node: default stroke, no warning stroke.
  await expect(canvas.locator(warningStroke)).toBeHidden();

  await colorSelect.selectOption("warning");
  await expect(canvas.locator(warningStroke).first()).toBeVisible();

  await colorSelect.selectOption("default");
  await expect(canvas.locator(warningStroke)).toBeHidden();
  await expect(canvas.locator(defaultStroke).first()).toBeVisible();
});

test("resetting border to Solid clears the dash array", async ({ page }) => {
  await openDiagram(page, "E2E border reset");
  await createComponent(page, "e2e-border");

  const canvas = page.getByTestId("diagram-canvas");
  const node = canvas.getByText("e2e-border").first();
  const box = await node.boundingBox();
  if (!box) throw new Error("created node has no bounding box");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByTestId("node-inspector")).toBeVisible();

  const borderSelect = page.locator("#comp-border-input");
  const dashedStroke = 'rect[stroke-dasharray="6 4"]';

  await borderSelect.selectOption("dashed");
  await expect(canvas.locator(dashedStroke).first()).toBeVisible();

  await borderSelect.selectOption("solid");
  await expect(canvas.locator(dashedStroke)).toBeHidden();
});

test("resetting font to Unstyled clears the bold weight", async ({ page }) => {
  await openDiagram(page, "E2E font reset");
  await createComponent(page, "e2e-font");

  const canvas = page.getByTestId("diagram-canvas");
  const node = canvas.getByText("e2e-font").first();
  const box = await node.boundingBox();
  if (!box) throw new Error("created node has no bounding box");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByTestId("node-inspector")).toBeVisible();

  const fontSelect = page.locator("#comp-font-input");
  const boldText = 'text[font-weight="bold"]';

  await fontSelect.selectOption("bold");
  await expect(canvas.locator(boldText).first()).toBeVisible();

  await fontSelect.selectOption("unstyled");
  await expect(canvas.locator(boldText)).toBeHidden();
});

test("pressing c cycles colors back to Default", async ({ page }) => {
  await openDiagram(page, "E2E color cycle");
  await createComponent(page, "e2e-cycle");

  const canvas = page.getByTestId("diagram-canvas");
  const node = canvas.getByText("e2e-cycle").first();
  const box = await node.boundingBox();
  if (!box) throw new Error("created node has no bounding box");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByTestId("node-inspector")).toBeVisible();

  const warningStroke = 'rect[stroke="var(--color-warning)"]';
  const defaultStroke = 'rect[stroke="var(--color-base-content)"]';

  await page.locator("#comp-color-input").selectOption("warning");
  await expect(canvas.locator(warningStroke).first()).toBeVisible();

  // warning -> error -> info -> default. The click above focused the
  // canvas, so the shortcuts fire.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.press("c");
  await page.keyboard.press("c");
  await page.keyboard.press("c");
  await expect(canvas.locator(warningStroke)).toBeHidden();
  await expect(canvas.locator(defaultStroke).first()).toBeVisible();
});

test("pressing f cycles fonts back to Unstyled", async ({ page }) => {
  await openDiagram(page, "E2E font cycle");
  await createComponent(page, "e2e-fcycle");

  const canvas = page.getByTestId("diagram-canvas");
  const node = canvas.getByText("e2e-fcycle").first();
  const box = await node.boundingBox();
  if (!box) throw new Error("created node has no bounding box");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByTestId("node-inspector")).toBeVisible();

  const boldText = 'text[font-weight="bold"]';

  await page.locator("#comp-font-input").selectOption("bold");
  await expect(canvas.locator(boldText).first()).toBeVisible();

  // bold -> italic -> underline -> unstyled.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.press("f");
  await page.keyboard.press("f");
  await page.keyboard.press("f");
  await expect(canvas.locator(boldText)).toBeHidden();
});
