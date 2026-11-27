import { expect, test } from "@playwright/test";
import { createFromExample, skipTourIfPresent, storedFiles } from "./helpers";

// The left sidebar's "Filters" section edits the open view's
// `filter.include_tags` — a coverage contract: every component tagged with one
// of them must be placed (W023). It only shows while nothing is selected.

const VIEW_PATH = "views/power-paths.hcl";

function viewHcl(files: Record<string, string>): string {
  const entry = Object.entries(files).find(([path]) =>
    path.endsWith(VIEW_PATH),
  );
  if (!entry) throw new Error(`no ${VIEW_PATH}, have: ${Object.keys(files)}`);
  return entry[1];
}

test("tag chips edit the view filter and list components it misses", async ({
  page,
}) => {
  const project = await createFromExample(
    page,
    /Quadcopter Drone/,
    "E2E view filter",
  );
  await page.goto(`/projects/${project}/modeling`);
  await skipTourIfPresent(page);
  await page.locator("button", { hasText: "power-paths.hcl" }).first().click();
  await expect(page).toHaveURL(/power-paths\.hcl$/);

  const filters = page.getByTestId("view-filters");
  await expect(filters).toBeVisible();
  // The example places every power-tagged component.
  await expect(filters.getByTestId("filter-tag")).toHaveText(["power ✕"]);
  await expect(filters.getByTestId("filter-complete")).toBeVisible();

  // Space confirms a chip. The drone's video parts are not on this view.
  const input = filters.getByLabel("Include tags");
  await input.fill("video");
  await input.press("Space");
  await expect(input).toHaveValue("");
  await expect(filters.getByTestId("filter-tag")).toHaveText([
    "power ✕",
    "video ✕",
  ]);
  const missing = filters.getByTestId("filter-missing");
  await expect(missing).toContainText("camera");
  await expect(missing).toContainText("vtx");

  await expect
    .poll(async () => viewHcl(await storedFiles(page)))
    .toMatch(/include_tags\s*=\s*\["power", "video"\]/);

  // Ctrl+Z takes the chip back, like any other edit of the view.
  await page.locator("body").press("ControlOrMeta+z");
  await expect(filters.getByTestId("filter-tag")).toHaveText(["power ✕"]);
  await expect(filters.getByTestId("filter-complete")).toBeVisible();

  await filters.getByRole("button", { name: "Remove tag power" }).click();
  await expect(filters.getByTestId("filter-tag")).toHaveCount(0);
  await expect
    .poll(async () => viewHcl(await storedFiles(page)))
    .not.toContain("filter {");
});

test("the Filters section hides while something is selected", async ({
  page,
}) => {
  const project = await createFromExample(
    page,
    /Quadcopter Drone/,
    "E2E view filter selection",
  );
  await page.goto(`/projects/${project}/modeling`);
  await skipTourIfPresent(page);
  await page.locator("button", { hasText: "power-paths.hcl" }).first().click();
  await expect(page.getByTestId("view-filters")).toBeVisible();

  // Selecting a node swaps the section out for the node inspector…
  const canvas = page.getByTestId("diagram-canvas");
  const node = canvas.getByText("battery", { exact: true }).first();
  const box = await node.boundingBox();
  if (!box) throw new Error("battery node has no bounding box");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByTestId("node-inspector")).toBeVisible();
  await expect(page.getByTestId("view-filters")).toBeHidden();

  // …and clicking empty canvas brings it back.
  const area = await canvas.boundingBox();
  if (!area) throw new Error("canvas has no bounding box");
  await page.mouse.click(area.x + 10, area.y + area.height - 10);
  await expect(page.getByTestId("view-filters")).toBeVisible();
});
