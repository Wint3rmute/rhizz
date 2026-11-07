import { expect, test } from "@playwright/test";
import {
  createNewProject,
  replaceModel,
  storedFiles,
  viewFile,
} from "./helpers";

// End-to-end projection lifecycle (SPEC.md §6.3–§6.5): a low-level connection
// shown through placed ancestors jumps to the real ports when the owners are
// revealed — without transferring the projected spot — and jumps back when an
// owner is hidden again. A hierarchy rename orphans the old spot: rendering
// ignores it, the view stays compilable, and the edge re-derives.
const MODEL = `protocol "sig" {}
component "sense" {
  leaf = true
  port "out" {
    protocol = "sig"
    role     = "provider"
  }
}
component "mod-a" {
  instance "sen-a" {
    source = "sense"
  }
}
component "mod-c" {
  instance "sen-c" {
    source = "sense"
  }
}
system "bench" {
  instance "A" {
    source = "mod-a"
  }
  instance "C" {
    source = "mod-c"
  }
  connection "low-link" {
    from = "A/sen-a/out"
    to   = "C/sen-c/out"
  }
}
`;

const RENAMED_MODEL = MODEL.replaceAll("sen-a", "sen-b");

async function viewText(
  page: import("@playwright/test").Page,
): Promise<string> {
  return viewFile(await storedFiles(page));
}

const pollView = (page: import("@playwright/test").Page) =>
  expect.poll(() => viewText(page), { timeout: 10_000 });

test("revealing and hiding owners jumps the edge without moving spots", async ({
  page,
}) => {
  const id = await createNewProject(page, "E2E projected transitions");
  await replaceModel(page, MODEL);
  await page.goto(`/projects/${id}/modeling`);
  await expect(page.getByTestId("diagram-toolbar")).toBeVisible();

  const tree = page.getByTestId("modeling-pane-right");
  const canvas = page.getByTestId("diagram-canvas");
  const row = page.getByTestId("connection-row-low-link");
  const badge = page.getByTestId("projected-badge-low-link");

  async function place(name: string): Promise<void> {
    const button = tree.getByRole("button", { name, exact: true });
    await expect(button).toBeVisible();
    const item = button.locator("xpath=parent::*");
    await item.getByRole("checkbox").check();
  }

  async function unplace(name: string): Promise<void> {
    const button = tree.getByRole("button", { name, exact: true });
    await expect(button).toBeVisible();
    const item = button.locator("xpath=parent::*");
    await item.getByRole("checkbox").uncheck();
  }

  await place("A");
  await place("C");
  await expect(badge).toBeVisible();

  // Drag the projected dot so the spot exists before the reveal.
  await tree.getByRole("button", { name: "A", exact: true }).click();
  const dot = canvas
    .getByTestId("diagram-port")
    .filter({ hasText: "sen-a/out" });
  const start = await dot.locator("circle").first().boundingBox();
  if (!start) throw new Error("no projected port dot box");
  const cx = start.x + start.width / 2;
  const cy = start.y + start.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy + 60, { steps: 8 });
  await page.mouse.up();
  await pollView(page).toContain('port "sen-a/out"');

  // Reveal the owners: the edge jumps to the real ports, the badge clears,
  // and the projected spot does NOT transfer onto the owner node.
  await tree.getByRole("button", { name: "Expand all" }).click();
  await place("sen-a");
  await place("sen-c");
  await expect(badge).toHaveCount(0);
  await expect(row.getByRole("checkbox")).toBeChecked();
  await expect(canvas.getByTestId("diagram-edge")).toHaveCount(1);
  await expect
    .poll(() => viewText(page), { timeout: 10_000 })
    .not.toContain('port "out"');

  // Hide an owner again: the edge jumps back to the projected rendering.
  await unplace("sen-a");
  await expect(badge).toBeVisible();
  await expect(row.getByRole("checkbox")).toBeChecked();
  await expect(canvas.getByTestId("diagram-edge")).toHaveCount(1);
});

test("a renamed descendant orphans its spot without breaking the view", async ({
  page,
}) => {
  const id = await createNewProject(page, "E2E projected stale spot");
  await replaceModel(page, MODEL);
  await page.goto(`/projects/${id}/modeling`);
  await expect(page.getByTestId("diagram-toolbar")).toBeVisible();

  const tree = page.getByTestId("modeling-pane-right");
  const canvas = page.getByTestId("diagram-canvas");

  const placeA = async () => {
    const button = tree.getByRole("button", { name: "A", exact: true });
    await expect(button).toBeVisible();
    await button.locator("xpath=parent::*").getByRole("checkbox").check();
  };
  await placeA();
  const placeC = async () => {
    const button = tree.getByRole("button", { name: "C", exact: true });
    await expect(button).toBeVisible();
    await button.locator("xpath=parent::*").getByRole("checkbox").check();
  };
  await placeC();

  // Drag the projected dot, then rename its owner out from under it.
  await tree.getByRole("button", { name: "A", exact: true }).click();
  const dot = canvas
    .getByTestId("diagram-port")
    .filter({ hasText: "sen-a/out" });
  const start = await dot.locator("circle").first().boundingBox();
  if (!start) throw new Error("no projected port dot box");
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    start.x + start.width / 2,
    start.y + start.height / 2 + 60,
    {
      steps: 8,
    },
  );
  await page.mouse.up();
  await pollView(page).toContain('port "sen-a/out"');

  await replaceModel(page, RENAMED_MODEL);
  await page.reload();
  await expect(page.getByTestId("diagram-toolbar")).toBeVisible();

  // The view still compiles and draws: the stale spot is preserved in the
  // file but ignored, and the edge re-derives under the new name.
  await expect(
    page.getByTestId("diagram-canvas").getByTestId("diagram-edge"),
  ).toHaveCount(1);
  await expect(page.getByTestId("projected-badge-low-link")).toBeVisible();
  await expect
    .poll(() => viewText(page), { timeout: 10_000 })
    .toContain('port "sen-a/out"');
});
