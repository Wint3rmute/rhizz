import { expect, test, type Page } from "@playwright/test";
import { createNewProject, replaceModel, storedFiles } from "./helpers";

// Realization is edited from the connection inspector through update_connection:
// removing one, undoing it, and refusing a cycle. Drives the real UI and reads
// the VFS back, so it pins what reaches the file.

// fund-transfer is declared last so it is drawn on top of http-request: the two
// edges overlap, and a click lands on the top one.
const MODEL = `protocol "payment" {}
protocol "https" {
  leaf         = true
  encapsulates = ["payment"]
}
component "bank" {
  leaf = true
  port "pay" {
    protocol = "payment"
  }
  port "web" {
    protocol = "https"
  }
}
system "banking" {
  instance "bank-a" {
    source = "bank"
  }
  instance "bank-b" {
    source = "bank"
  }
  connection "http-request" {
    from = "bank-a/web"
    to   = "bank-b/web"
  }
  connection "fund-transfer" {
    from        = "bank-a/pay"
    to          = "bank-b/pay"
    realized_by = ["http-request"]
  }
}
`;

async function systemText(page: Page): Promise<string> {
  const files = await storedFiles(page);
  return files["main.hcl"] ?? files["system.hcl"] ?? "";
}

// The seeded instances are listed but not placed; ticking their tree rows
// places them in the open view, which draws the connections between them.
async function placeInstances(page: Page): Promise<void> {
  const tree = page.getByTestId("modeling-pane-right");
  for (const name of ["bank-a", "bank-b"]) {
    await tree
      .locator("li", { hasText: name })
      .first()
      .getByRole("checkbox")
      .check();
  }
  // Both land on the same spot; move bank-b aside so the edges are clickable.
  await tree.getByRole("button", { name: "bank-b", exact: true }).click();
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("ArrowRight");
  }
}

async function openConnection(page: Page, label: string): Promise<void> {
  const edge = page
    .getByTestId("diagram-canvas")
    .getByTestId("diagram-edge")
    .filter({ hasText: label })
    .first();
  await expect(edge).toBeVisible();
  await edge.click({ force: true });
  await expect(page.getByTestId("connection-inspector")).toBeVisible();
  await expect(
    page
      .getByTestId("connection-inspector")
      .getByRole("heading", { name: label }),
  ).toBeVisible();
}

test("a realization can be removed, undone, and a cycle is refused", async ({
  page,
}) => {
  const id = await createNewProject(page, "E2E realization");
  await replaceModel(page, MODEL);
  await page.goto(`/projects/${id}/modeling`);
  await expect(page.getByTestId("diagram-toolbar")).toBeVisible();
  await placeInstances(page);
  await openConnection(page, "fund-transfer");

  const connection = page.getByTestId("connection-attributes");
  const realized = connection.getByTestId("realized-by-list");
  await expect(realized.getByText("http-request")).toBeVisible();
  const status = connection.getByTestId("realization-status");
  await expect(status).toHaveText("complete");

  // Remove the realization: fund-transfer is no longer complete.
  await realized
    .getByRole("button", { name: "Remove realization http-request" })
    .click();
  await expect(realized.getByText("http-request")).toBeHidden();
  await expect(status).toHaveText("incomplete");
  await expect
    .poll(async () => (await systemText(page)).includes("realized_by"), {
      timeout: 10_000,
    })
    .toBe(false);

  // Undo restores the realization in the file.
  await page.keyboard.press("ControlOrMeta+z");
  await expect
    .poll(async () => (await systemText(page)).includes("realized_by"), {
      timeout: 10_000,
    })
    .toBe(true);
  // Undo also clears the canvas selection, so the inspector is reopened.
  await openConnection(page, "fund-transfer");
  await expect(
    page
      .getByTestId("connection-attributes")
      .getByTestId("realized-by-list")
      .getByText("http-request"),
  ).toBeVisible();

  // Making http-request realized by fund-transfer closes a cycle: refused,
  // with the toast, and the file stays as it was.
  // http-request sits under fund-transfer on the canvas, so reach it through
  // the realization list's Show button rather than a click.
  await connection
    .getByRole("button", { name: "Select http-request on canvas" })
    .click();
  await expect(
    page.getByTestId("connection-inspector").getByRole("heading", {
      name: "http-request",
    }),
  ).toBeVisible();
  const http = page.getByTestId("connection-attributes");
  const before = await systemText(page);
  await http
    .getByLabel("Add realization")
    .selectOption({ label: "fund-transfer (banking)" });
  await expect(page.getByText("Change refused")).toBeVisible();
  expect(await systemText(page)).toBe(before);
});
