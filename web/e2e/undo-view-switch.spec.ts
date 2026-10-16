import { expect, test } from "@playwright/test";
import { createFromExample, skipTourIfPresent } from "./helpers";

// Undo history belongs to the diagram it was recorded on. Switching views
// must not leave the previous view's snapshots reachable from Ctrl+Z, or
// undo will paint view A's layout onto view B.
test("ctrl+z after switching views does not restore the previous view", async ({
  page,
}) => {
  await createFromExample(page, /Quadcopter Drone/, "E2E undo view switch");
  const projectId = new URL(page.url()).pathname.split("/")[2];
  await page.goto(`/projects/${projectId}/modeling`);
  await skipTourIfPresent(page);

  // Diagram A: place one component, which records an undo point.
  await page.locator("button", { hasText: "fc-internals.hcl" }).first().click();
  await expect(page).toHaveURL(/fc-internals\.hcl$/);
  await page.waitForTimeout(1000);
  const checkboxA = page.getByRole("checkbox").first();
  await expect(checkboxA).toBeVisible();
  const checkedBeforeA = await checkboxA.isChecked();
  await checkboxA.click();
  await expect(checkboxA).toBeChecked({ checked: !checkedBeforeA });

  // Diagram B: a different view. Remember its exact checkbox state.
  await page.locator("button", { hasText: "overview.hcl" }).first().click();
  await expect(page).toHaveURL(/overview\.hcl$/);
  await page.waitForTimeout(1000);
  const checkboxStates = async () =>
    page
      .getByRole("checkbox")
      .evaluateAll((els) => els.map((el) => (el as HTMLInputElement).checked));
  const before = await checkboxStates();

  // Nothing was done on B, so there is nothing to undo.
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("activity-hint")).toHaveText(
    "No more actions to undo",
  );
  await expect.poll(checkboxStates).toEqual(before);
});
