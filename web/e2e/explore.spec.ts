import { expect, test } from "@playwright/test";
import { createFromExample } from "./helpers";

test("explore renders a drone diagram, toast, and embed modal", async ({ page }) => {
  const id = await createFromExample(
    page,
    /Quadcopter Drone/,
    "E2E explore drone",
  );
  await page.goto(`/projects/${id}/explore`);

  const battery = page.getByRole("link", {
    name: /battery, no detailed view/i,
  });
  await expect(battery).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Diagram breadcrumb" }))
    .toBeVisible();

  await battery.click();
  await expect(page.getByText("No detailed view for battery created"))
    .toBeVisible();

  await page.getByRole("button", { name: /embed diagram/i }).click();
  await expect(page.getByText("Direct Embed URL")).toBeVisible();
  await expect(page.getByText("HTML <iframe> Embed Code")).toBeVisible();
});

test("explore opens a layout-bearing view, not a filter-only one", async ({ page }) => {
  const id = await createFromExample(
    page,
    /Software House/,
    "E2E explore software-house",
  );
  await page.goto(`/projects/${id}/explore`);

  await expect(
    page.getByRole("link", { name: /engineering, no detailed view/i }),
  ).toBeVisible();
  await expect(page.getByText(/engineering-teams\.hcl/)).toHaveCount(0);
});
