import { expect, test } from "@playwright/test";

// System-bound views: each diagram is bound to one system at creation and
// the binding is immutable — the header shows it read-only and the
// Components explorer only shows that system's tree.
async function openDiagram(page, name = "E2E system view") {
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

test("view stays bound to its system after a second system is added", async ({
  page,
}) => {
  await openDiagram(page);

  // Fresh project seeds diagrams/main.hcl bound to the auto-created main system.
  const header = page.getByTestId("diagram-system-label");
  await expect(header).toContainText("system: main");

  // Add a component (default parent is the bound system root).
  await page.getByRole("button", { name: "+ Component" }).click();
  const modal = page.getByTestId("create-component-modal");
  await expect(modal).toBeVisible();
  await modal.locator("#new-comp-name").fill("in-main");
  await modal.getByRole("button", { name: "Create Definition" }).click();
  await expect(modal).toBeHidden();
  await expect(page.getByTestId("diagram-canvas").getByText("in-main").first())
    .toBeVisible();

  // Add a second system via the toolbar. The view must stay bound to main.
  page.off("dialog");
  const seen: string[] = [];
  page.on("dialog", (dialog) => {
    seen.push(dialog.message());
    void dialog.accept("second");
  });
  await page.getByRole("button", { name: "+ System" }).click();
  await expect(header).toContainText("system: main");
  // Explorer still shows main's tree, not an empty second-system tree.
  await expect(page.getByText("in-main").first()).toBeVisible();
  expect(seen.join("\n")).toContain("New system name?");
});
