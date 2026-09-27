import { expect, test } from "@playwright/test";
import { createFromExample } from "./helpers";

// System-bound views: each diagram is bound to one system at creation and
// the binding is immutable — the header shows it read-only and the
// Components explorer only shows that system's tree.
test("view stays bound to its system when the model holds several", async ({ page }) => {
  // The drone example ships two systems ("quadcopter" and "ground-control")
  // with views/main.hcl bound to "quadcopter", so the multi-system case
  // comes from a fixture rather than from a UI action.
  const id = await createFromExample(
    page,
    /Quadcopter Drone/,
    "E2E system view",
  );
  await page.goto(`/projects/${id}/modeling?diagram=views%2Fmain.hcl`);

  const header = page.getByTestId("diagram-system-label");
  await expect(header).toContainText("system: quadcopter");

  // The explorer shows the bound system's own instances, and the other
  // system's root never shows up (the bound system's root row is hidden).
  const sidebar = page.locator("aside").filter({
    has: page.getByRole("heading", { name: "Components" }),
  });
  await expect(sidebar.getByText("flight-controller").first()).toBeVisible();
  await expect(sidebar.getByText("ground-control")).toHaveCount(0);

  // The toolbar used to offer "+ System". A view is bound to exactly one
  // system, so adding another from here could never change what this
  // diagram shows. The model op behind the button is still reachable from
  // the code editor.
  await expect(
    page.getByTestId("diagram-toolbar").getByRole("button", {
      name: "+ System",
    }),
  ).toHaveCount(0);
});
