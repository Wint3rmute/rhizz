import { expect, test } from "@playwright/test";
import {
  createNewProject,
  replaceModel,
  storedFiles,
  viewFile,
} from "./helpers";

// A projected port dot drags along its ancestor's outline exactly like a
// real one, and the spot persists per view as `port "<rel>/<port>"`.
// Starting a connection from a projected dot is refused: projected ports are
// view-level representations, never system endpoints (SPEC.md §6.4).
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

async function viewText(
  page: import("@playwright/test").Page,
): Promise<string> {
  return viewFile(await storedFiles(page));
}

const pollView = (page: import("@playwright/test").Page) =>
  expect.poll(() => viewText(page), { timeout: 10_000 });

test("a projected port dot drags, persists, and cannot start a connection", async ({
  page,
}) => {
  const id = await createNewProject(page, "E2E projected port");
  await replaceModel(page, MODEL);
  await page.goto(`/projects/${id}/modeling`);
  await expect(page.getByTestId("diagram-toolbar")).toBeVisible();

  const tree = page.getByTestId("modeling-pane-right");
  const canvas = page.getByTestId("diagram-canvas");

  async function place(name: string): Promise<void> {
    const button = tree.getByRole("button", { name, exact: true });
    await expect(button).toBeVisible();
    const item = button.locator("xpath=parent::*");
    await item.getByRole("checkbox").check();
  }

  await place("A");
  await place("C");
  // Select A so its used port dots render.
  await tree.getByRole("button", { name: "A", exact: true }).click();

  const dot = canvas
    .getByTestId("diagram-port")
    .filter({ hasText: "sen-a/out" });
  await expect(dot).toBeVisible();
  // Two circles = hit area + dot: the projected port renders like a real one.
  await expect(dot.locator("circle")).toHaveCount(2);
  const start = await dot.locator("circle").first().boundingBox();
  if (!start) throw new Error("no projected port dot box");
  const cx = start.x + start.width / 2;
  const cy = start.y + start.height / 2;

  // Alt+drag from a projected dot starts no connection.
  await page.mouse.move(cx, cy);
  await page.keyboard.down("Alt");
  await page.mouse.down();
  await page.mouse.move(cx + 40, cy, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await expect(page.getByTestId("new-connection-modal")).toHaveCount(0);
  await expect
    .poll(() => viewText(page), { timeout: 10_000 })
    .not.toContain('connection "sen-a');

  // Plain drag moves the dot and persists the projected spot.
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy + 60, { steps: 8 });
  await page.mouse.up();
  await pollView(page).toContain('port "sen-a/out"');

  // The spot survives a reload.
  await page.reload();
  await expect(page.getByTestId("diagram-toolbar")).toBeVisible();
  await expect
    .poll(() => viewText(page), { timeout: 10_000 })
    .toContain('port "sen-a/out"');
});
