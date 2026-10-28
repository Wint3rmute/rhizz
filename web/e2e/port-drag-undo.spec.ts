import { expect, type Page, test } from "@playwright/test";
import {
  createNewProject,
  replaceModel,
  storedFiles,
  viewFile,
} from "./helpers";

// Dragging a port dot along the outline persists a per-view spot, and one
// undo step removes it again — the port falls back to its role default.
const MODEL = `component "sensor" {
  leaf = true
  port "data" {
    protocol = "mqtt"
    role     = "provider"
  }
}

system "demo" {
  instance "sensor" { source = "sensor" }
}
`;

async function viewText(page: Page): Promise<string> {
  return viewFile(await storedFiles(page));
}

const pollView = (page: Page) =>
  expect.poll(() => viewText(page), { timeout: 10_000 });

test("dragging a port persists its spot; undo removes it", async ({ page }) => {
  const id = await createNewProject(page, "E2E port drag undo");
  await replaceModel(page, MODEL);
  await page.goto(`/projects/${id}/modeling`);
  await expect(page.getByTestId("diagram-toolbar")).toBeVisible();

  // Place and select the instance so its port dot renders (the tree row
  // button selects; the SVG label itself is pointer-events:none).
  const tree = page.getByTestId("modeling-pane-right");
  await tree
    .locator("li", { hasText: "sensor" })
    .first()
    .getByRole("checkbox")
    .check();
  await tree.getByRole("button", { name: "sensor", exact: true }).click();
  const canvas = page.getByTestId("diagram-canvas");

  const dot = canvas.getByTestId("diagram-port").first();
  // Two circles = hit area + dot: proves the node is selected (labels alone
  // render no circles).
  await expect(dot.locator("circle")).toHaveCount(2);
  const start = await dot.locator("circle").first().boundingBox();
  if (!start) throw new Error("no port dot box");
  const cx = start.x + start.width / 2;
  const cy = start.y + start.height / 2;

  // Drag down along the outline; snap-to-grid is on, so any motion persists.
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy + 60, { steps: 8 });
  await page.mouse.up();

  await pollView(page).toContain('port "data"');

  await page.keyboard.press("ControlOrMeta+z");
  await pollView(page).not.toContain('port "data"');
});
