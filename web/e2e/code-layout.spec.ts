import { expect, test } from "@playwright/test";

// The Code page is a modular workspace like Modeling and Inventory: a
// resizable file sidebar on the left, the editor filling the main area, and
// the Monaco editor running all the way down to the diagnostics status bar
// with no gaps.
async function openCodePage(page, name: string) {
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
  await page.goto(`/projects/${id}/code`);
  await expect(page.locator(".monaco-editor").first()).toBeVisible();
}

test("code page puts the file sidebar beside the editor", async ({ page }) => {
  await openCodePage(page, "E2E code panes");

  const files = page.getByTestId("code-pane-left");
  const editor = page.locator(".monaco-editor").first();
  await expect(files).toBeVisible();
  await expect(files.getByRole("heading", { name: "Files" })).toBeVisible();

  const filesBox = await files.boundingBox();
  const editorBox = await editor.boundingBox();
  if (!filesBox || !editorBox) {
    throw new Error("both regions should be laid out");
  }

  // Beside, not below: the editor starts where the sidebar ends.
  expect(editorBox.x).toBeGreaterThanOrEqual(filesBox.x + filesBox.width - 1);
  expect(editorBox.y).toBeLessThan(filesBox.y + filesBox.height);
});

test("code page editor fills the height down to the status bar", async ({ page }) => {
  await openCodePage(page, "E2E code full height");

  const editor = page.locator(".monaco-editor").first();
  const bar = page.getByTestId("diagnostics-status-bar");
  await expect(bar).toBeVisible();

  const editorBox = await editor.boundingBox();
  const barBox = await bar.boundingBox();
  if (!editorBox || !barBox) {
    throw new Error("editor and bar should be laid out");
  }

  // No gap between the editor and the bottom bar (1px for sub-pixel rounding).
  expect(Math.abs(editorBox.y + editorBox.height - barBox.y))
    .toBeLessThanOrEqual(1);
  // The editor is tall, not a fixed-height strip.
  expect(editorBox.height).toBeGreaterThan(300);
});

test("code page hides and restores the file sidebar without unmounting it", async ({ page }) => {
  await openCodePage(page, "E2E code hide");

  await page.getByRole("button", { name: "Hide Files" }).click();
  await expect(page.getByTestId("code-pane-left")).toBeHidden();
  await expect(page.getByRole("button", { name: "Show Files" })).toBeVisible();

  await page.getByRole("button", { name: "Show Files" }).click();
  await expect(page.getByTestId("code-pane-left")).toBeVisible();
  await expect(page.locator(".monaco-editor").first()).toBeVisible();
});

test("code page editor sits on the same bright tone as the file sidebar", async ({ page }) => {
  await openCodePage(page, "E2E code colors");

  // Computed colours come back in whatever notation the browser picked
  // (oklch for the probe, rgb for the elements), so each one is normalised
  // through a canvas pixel read before comparing.
  const toPixel = (color: string) =>
    page.evaluate((c) => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context");
      ctx.fillStyle = "#000";
      ctx.fillStyle = c;
      ctx.fillRect(0, 0, 1, 1);
      return Array.from(ctx.getImageData(0, 0, 1, 1).data).join(",");
    }, color);

  // The bright panel tone, resolved through the app's own theme: a
  // throwaway element with the same class the file sidebar uses.
  const panel = await toPixel(
    await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.className = "bg-base-100";
      document.body.appendChild(probe);
      const color = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return color;
    }),
  );

  const background = async (locator: ReturnType<typeof page.locator>) =>
    toPixel(
      await locator.evaluate((el) => getComputedStyle(el).backgroundColor),
    );

  const main = page.getByTestId("code-workspace").locator("main");
  const sidebar = page.getByTestId("code-pane-left");
  const surface = page.locator(".monaco-editor .monaco-editor-background")
    .first();

  expect(await background(main)).toBe(panel);
  expect(await background(surface)).toBe(panel);
  expect(await background(sidebar)).toBe(panel);
});
