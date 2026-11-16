import { expect, test } from "@playwright/test";
import {
  createNewProject,
  replaceModel,
  storedFiles,
  viewFile,
} from "./helpers";

// Delegation (SPEC.md §6.9): the boundary dot forwards inward with one segment
// per hop, drawn as a plain line without an arrowhead. Closed box shows only
// the assembly edge; opening the box adds the internal segment; hiding the
// child removes it again. The delegation row is never badged `Projected`.
const MODEL = `protocol "sig" {}
component "leaf" {
  leaf = true
  port "http" {
    protocol = "sig"
    role     = "provider"
  }
}
component "svc" {
  port "api" { external = true }
  instance "proxy" { source = "leaf" }
  connection "api-delegation" {
    from = "./api"
    to   = "proxy/http"
  }
}
component "user" {
  leaf = true
  port "out" {
    protocol = "sig"
    role     = "consumer"
  }
}
system "app" {
  instance "user" { source = "user" }
  instance "svc" { source = "svc" }
  connection "forecast" {
    from = "user/out"
    to   = "svc/api"
  }
}
`;

test("delegation draws arrowless only when owner and child are placed", async ({
  page,
}) => {
  const id = await createNewProject(page, "E2E delegation edges");
  await replaceModel(page, MODEL);
  await page.goto(`/projects/${id}/modeling`);
  await expect(page.getByTestId("diagram-toolbar")).toBeVisible();

  const tree = page.getByTestId("modeling-pane-right");
  const canvas = page.getByTestId("diagram-canvas");
  const delegationRow = page.getByTestId("connection-row-api-delegation");
  const delegationBadge = page.getByTestId("projected-badge-api-delegation");

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

  const edges = () => canvas.getByTestId("diagram-edge");
  const arrows = () => canvas.getByTestId("diagram-edge").locator("polygon");

  // Closed box: only the assembly edge draws, with its arrowhead.
  await place("user");
  await place("svc");
  await expect(edges()).toHaveCount(1);
  await expect(arrows()).toHaveCount(1);
  await expect(delegationRow).toBeVisible();
  await expect(delegationBadge).toHaveCount(0);

  // Open box: the delegation segment draws too, without an arrowhead.
  await tree.getByRole("button", { name: "Expand all" }).click();
  await place("proxy");
  await expect(edges()).toHaveCount(2);
  await expect(arrows()).toHaveCount(1);
  await expect(edges().filter({ hasText: "forecast" })).toHaveCount(1);
  await expect(edges().filter({ hasText: "api-delegation" })).toHaveCount(1);
  await expect(delegationBadge).toHaveCount(0);

  // Half-open again: hiding the child removes the delegation segment.
  await unplace("proxy");
  await expect(edges()).toHaveCount(1);
  await expect(arrows()).toHaveCount(1);
});

test("a proxy boundary dot drags and persists like a real port", async ({
  page,
}) => {
  const id = await createNewProject(page, "E2E delegation port drag");
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

  await place("user");
  await place("svc");
  await tree.getByRole("button", { name: "svc", exact: true }).click();

  const dot = canvas.getByTestId("diagram-port").filter({ hasText: "api" });
  await expect(dot).toBeVisible();
  await expect(dot.locator("circle")).toHaveCount(2);
  const start = await dot.locator("circle").first().boundingBox();
  if (!start) throw new Error("no boundary port dot box");
  const cx = start.x + start.width / 2;
  const cy = start.y + start.height / 2;

  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy + 60, { steps: 8 });
  await page.mouse.up();

  const viewText = async (): Promise<string> =>
    viewFile(await storedFiles(page));
  await expect
    .poll(() => viewText(page), { timeout: 10_000 })
    .toContain('port "api"');

  await page.reload();
  await expect(page.getByTestId("diagram-toolbar")).toBeVisible();
  await expect
    .poll(() => viewText(page), { timeout: 10_000 })
    .toContain('port "api"');
});
