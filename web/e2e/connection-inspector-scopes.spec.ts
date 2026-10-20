import { expect, test, type Page } from "@playwright/test";
import { createNewProject, replaceModel, storedFiles } from "./helpers";

// The connection inspector has three panels and each writes to a different
// place: protocol is read-only, the connection's own fields go to the system
// file, and the side pickers go to the open view's file. This drives the
// real UI and reads the VFS back, so it pins where each edit lands.

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

async function viewsText(page: Page): Promise<string> {
  const files = await storedFiles(page);
  return Object.entries(files)
    .filter(([path]) => path.startsWith("views/"))
    .map(([, content]) => content)
    .join("\n");
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

test("each connection panel writes to the file it belongs to", async ({
  page,
}) => {
  const id = await createNewProject(page, "E2E connection scopes");
  await replaceModel(page, MODEL);
  await page.goto(`/projects/${id}/modeling`);
  await expect(page.getByTestId("diagram-toolbar")).toBeVisible();
  await placeInstances(page);
  await openConnection(page, "fund-transfer");

  const protocol = page.getByTestId("protocol-attributes");
  const connection = page.getByTestId("connection-attributes");
  const view = page.getByTestId("view-attributes");

  // The protocol panel has nothing to edit.
  await expect(protocol.getByRole("textbox")).toHaveCount(0);
  await expect(protocol.getByRole("spinbutton")).toHaveCount(0);

  // A full-name edit lands in the system file and nowhere else.
  await connection.getByLabel(/^full name$/i).fill("Fund transfer v2");
  await connection.getByLabel(/^full name$/i).blur();
  await expect
    .poll(async () => (await systemText(page)).includes('"Fund transfer v2"'), {
      timeout: 10_000,
    })
    .toBe(true);
  expect(await viewsText(page)).not.toContain("Fund transfer v2");

  // A side change lands in the view file and never in the system file.
  await view.getByRole("button", { name: "Top", exact: true }).first().click();
  await expect
    .poll(async () => (await viewsText(page)).includes("top"), {
      timeout: 10_000,
    })
    .toBe(true);
  expect(await systemText(page)).not.toContain("start_side");
});
