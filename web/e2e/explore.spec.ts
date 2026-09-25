import { expect, test } from "@playwright/test";
import { createFromExample } from "./helpers";

test("explore renders a drone diagram, toast, and embed modal", async ({ page }) => {
  const id = await createFromExample(
    page,
    /Quadcopter Drone/,
    "E2E explore drone",
  );
  await page.goto(`/projects/${id}/explore`);

  // Explore opens the first layout-bearing view (ground-station.hcl for drone).
  const goggles = page.getByRole("link", {
    name: /goggles, no detailed view/i,
  });
  await expect(goggles).toBeVisible();

  // No second navbar above the canvas: the diagrams sidebar carries the
  // whole chrome (file tree + the open diagram + the embed button).
  await expect(page.getByRole("navigation")).toHaveCount(0);
  const sidebar = page.getByRole("complementary", { name: "Diagrams" });
  await expect(sidebar).toBeVisible();
  // The open diagram is marked in the tree itself (aria-current), so the
  // breadcrumb that used to spell it out is redundant. The mobile chip row
  // is hidden on this viewport, hence the row-scoped lookup.
  const openRow = sidebar.locator("li button[aria-current='true']");
  await expect(openRow).toHaveCount(1);
  await expect(openRow).toHaveText(/^ground-station\.hcl$/);

  await goggles.click();
  await expect(page.getByText("No detailed view for goggles created"))
    .toBeVisible();

  // The embed action lives at the bottom of that same sidebar.
  const embed = sidebar.getByRole("button", { name: /embed diagram/i });
  await expect(embed).toBeVisible();
  await embed.click();
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
