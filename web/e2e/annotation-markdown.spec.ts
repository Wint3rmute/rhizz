import { expect, test } from "@playwright/test";

// Markdown annotations render as styled SVG (pure <text>/<tspan>, no
// foreignObject): headings sized+bold, **bold** as font-weight runs,
// lists with bullet prefixes — never the raw `**` source. Notes are edited
// through the Inspector sidebar (text + scale), never a canvas pop-up.
async function openModeling(page, name = "E2E markdown notes") {
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
  await page.goto(`/projects/${id}/modeling`);
  await expect(page.getByTestId("diagram-toolbar")).toBeVisible();
  await expect(page.getByTestId("diagram-canvas")).toBeVisible();
  if (!id) throw new Error("project id missing from URL");
  return id;
}

test("markdown note renders styled runs, not raw syntax", async ({ page }) => {
  await openModeling(page);
  const canvas = page.getByTestId("diagram-canvas");

  await page.getByRole("button", { name: "+ Note" }).click();
  const inspector = page.getByTestId("annotation-inspector");
  await expect(inspector).toBeVisible();
  const editor = page.getByTestId("annotation-text-input");
  await expect(editor).toBeVisible();
  // The inspector editor autofocuses on open: typing flows straight in.
  await expect(editor).toBeFocused();
  const noteText = canvas.getByText("New note");
  await expect(noteText).toBeVisible();

  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("# Ingest path\n\nCarries **raw** events");
  // The canvas re-renders live as the inspector text changes.
  await expect(canvas.getByText("Ingest path")).toBeVisible();
  await expect(canvas.getByText("# Ingest path")).toBeHidden();
  // Clicking the canvas commits the edit; the inspector keeps showing it.
  await page.mouse.click(30, 400);
  await expect(editor).not.toBeFocused();
  await expect(inspector).toBeVisible();

  // Heading renders without the `# ` marker, bold run carries font-weight.
  await expect(canvas.getByText("Ingest path")).toBeVisible();
  const bold = canvas.getByText("raw");
  await expect(bold).toBeVisible();
  await expect(bold).toHaveAttribute("font-weight", "bold");
  await expect(canvas.getByText("**raw**")).toBeHidden();

  // A bullet list renders with a bullet prefix, not `- ` source.
  await page.getByRole("button", { name: "+ Note" }).click();
  const editor2 = page.getByTestId("annotation-text-input");
  await expect(editor2).toBeVisible();
  await editor2.fill("- fast\n- slow");
  // Escape commits the edit and leaves the field.
  await page.keyboard.press("Escape");
  await expect(editor2).not.toBeFocused();
  await expect(canvas.getByText("fast")).toBeVisible();
  await expect(canvas.getByText("- fast")).toBeHidden();
});

test("double-clicking a note focuses the inspector editor", async ({ page }) => {
  await openModeling(page);
  const canvas = page.getByTestId("diagram-canvas");

  await page.getByRole("button", { name: "+ Note" }).click();
  const editor = page.getByTestId("annotation-text-input");
  await expect(editor).toBeFocused();
  // Leave the field so the double-click has somewhere to jump from.
  await page.mouse.click(30, 400);
  await expect(editor).not.toBeFocused();

  const noteText = canvas.getByText("New note");
  await expect(noteText).toBeVisible();
  const box = await noteText.boundingBox();
  if (!box) throw new Error("note has no bounding box");
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await expect(editor).toBeFocused();
  // No pop-up editor is ever overlaid on the canvas.
  await expect(page.getByTestId("annotation-editor")).toHaveCount(0);
});

test("annotation scale input resizes the rendered note", async ({ page }) => {
  await openModeling(page);
  const canvas = page.getByTestId("diagram-canvas");

  await page.getByRole("button", { name: "+ Note" }).click();
  const scaleInput = page.getByTestId("annotation-scale-input");
  await expect(scaleInput).toBeVisible();
  await expect(scaleInput).toHaveValue("1");
  const note = canvas.locator("text").filter({ hasText: "New note" });
  await expect(note).toHaveAttribute("font-size", "12");

  await scaleInput.fill("2");
  await page.mouse.click(30, 400);
  await expect(scaleInput).toHaveValue("2");
  await expect(note).toHaveAttribute("font-size", "24");

  // Below the 0.5 floor clamps; clearing the field floors too (empty
  // parses as 0, and number inputs only ever hold numeric text).
  await scaleInput.fill("0.1");
  await page.mouse.click(30, 400);
  await expect(scaleInput).toHaveValue("0.5");
  await expect(note).toHaveAttribute("font-size", "6");
  await scaleInput.fill("");
  await page.mouse.click(30, 400);
  await expect(scaleInput).toHaveValue("0.5");
  await expect(note).toHaveAttribute("font-size", "6");
});
