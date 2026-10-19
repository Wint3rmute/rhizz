import { expect, test } from "@playwright/test";

test("book embed shows the diagram and can switch to code", async ({
  page,
}) => {
  await page.goto("/book-example?example=drone");
  await expect(page.getByText("flight-controller").first()).toBeVisible();
  await expect(page.getByRole("tablist")).toBeVisible();

  await page.getByRole("tab", { name: "system.hcl" }).click();
  await expect(page.locator("pre")).toContainText(
    'component "flight-controller"',
  );
});

test("book embed transitions between diagram views", async ({ page }) => {
  await page.goto("/book-example?example=drone");
  await expect(page.getByText("flight-controller").first()).toBeVisible();

  await page.getByRole("tab", { name: "views/ground-station.hcl" }).click();
  // Scope to the diagram <svg>: "battery" also appears as inline code in
  // diagnostics, which must not count here.
  const diagram = page.locator("svg");
  await expect(diagram.getByText("goggles").first()).toBeVisible();
  // The previous view's nodes fade out rather than persisting after the switch.
  await expect(diagram.getByText("battery")).toBeHidden();
});

test("book embed ?open= lands on that file's code", async ({ page }) => {
  await page.goto("/book-example?example=drone&open=system.hcl");
  await expect(page.locator("pre")).toContainText(
    'component "flight-controller"',
  );
  await expect(
    page.getByRole("button", { name: "Diagram view unavailable" }),
  ).toBeDisabled();
});
