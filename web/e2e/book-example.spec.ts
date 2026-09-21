import { expect, test } from "@playwright/test";

test("book embed shows the diagram and can switch to code", async ({ page }) => {
  await page.goto("/book-example?example=drone");
  await expect(page.getByText("flight-controller").first()).toBeVisible();
  await expect(page.getByRole("tablist")).toBeVisible();

  await page.getByRole("tab", { name: "system.hcl" }).click();
  await expect(page.locator("pre")).toContainText(
    'component "flight-controller"',
  );
});

test("book embed ?open= lands on that file's code", async ({ page }) => {
  await page.goto("/book-example?example=drone&open=system.hcl");
  await expect(page.locator("pre")).toContainText(
    'component "flight-controller"',
  );
  await expect(page.getByRole("button", { name: "Diagram view unavailable" }))
    .toBeDisabled();
});

test("single-file book embed hides the tab bar", async ({ page }) => {
  await page.goto("/book-example?example=single-file");
  await expect(page.locator("pre")).toContainText("project");
  await expect(page.getByRole("tablist")).toHaveCount(0);
});
