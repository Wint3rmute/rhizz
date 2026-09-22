import { expect, test } from "@playwright/test";

// Markdown annotations render as styled SVG (pure <text>/<tspan>, no
// foreignObject): headings sized+bold, **bold** as font-weight runs,
// lists with bullet prefixes — never the raw `**` source.
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
  const editor = page.getByTestId("annotation-editor");
  await expect(editor).toBeVisible();
  await editor.fill("# Ingest path\n\nCarries **raw** events");
  // Plain Enter commits the edit (Alt+Enter inserts a newline).
  await page.keyboard.press("Enter");
  await expect(editor).toBeHidden();

  // Heading renders without the `# ` marker, bold run carries font-weight.
  await expect(canvas.getByText("Ingest path")).toBeVisible();
  await expect(canvas.getByText("# Ingest path")).toBeHidden();
  const bold = canvas.getByText("raw");
  await expect(bold).toBeVisible();
  await expect(bold).toHaveAttribute("font-weight", "bold");
  await expect(canvas.getByText("**raw**")).toBeHidden();

  // A bullet list renders with a bullet prefix, not `- ` source.
  await page.getByRole("button", { name: "+ Note" }).click();
  const editor2 = page.getByTestId("annotation-editor");
  await expect(editor2).toBeVisible();
  await editor2.fill("- fast\n- slow");
  await page.keyboard.press("Enter");
  await expect(editor2).toBeHidden();
  await expect(canvas.getByText("fast")).toBeVisible();
  await expect(canvas.getByText("- fast")).toBeHidden();
});
