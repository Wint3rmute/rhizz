import { expect, type Page, test } from "@playwright/test";
import { createNewProject, replaceModel, storedFiles } from "./helpers";

// Inventory → Protocols: the project's protocols can be added, edited and
// removed from the Inventory. Every edit is written to the model file, and a
// refusal is always visible as a "Change refused" toast.
//
// Seed: protocols "power" and "bus", and a "battery" component whose port uses
// "power". With that port in place, "power" is in use and cannot be deleted.

const SEED = `project {
  name    = "protocols"
  version = "0.1.0"
}

protocol "power" {
  full_name = "DC power"
}

protocol "bus" {
}

component "battery" {
  leaf = true

  port "out" {
    protocol = "power"
    role     = "provider"
  }
}
`;

/** The top-level model file's content, whichever name the project gave it. */
async function modelFile(page: Page): Promise<string> {
  const files = await storedFiles(page);
  return files["main.hcl"] ?? files["system.hcl"] ?? "";
}

async function seededProject(page: Page, name: string): Promise<string> {
  const id = await createNewProject(page, name);
  await replaceModel(page, SEED);
  return id;
}

async function openProtocol(
  page: Page,
  id: string,
  label: string,
): Promise<void> {
  await page.goto(`/projects/${id}/inventory?tab=protocols&protocol=${label}`);
  await expect(
    page.getByTestId("protocol-detail-pane").getByRole("heading", {
      name: label,
    }),
  ).toBeVisible();
}

test("adding a protocol writes it to the model and opens it", async ({
  page,
}) => {
  const id = await createNewProject(page, "E2E protocols add");
  await page.goto(`/projects/${id}/inventory`);
  await page.getByRole("tab", { name: "Protocols" }).click();
  await expect(page).toHaveURL(`/projects/${id}/inventory?tab=protocols`);

  await page.getByTestId("inventory-add-entity").click();
  const modal = page.getByTestId("create-protocol-modal");
  await expect(modal).toBeVisible();
  await modal.locator("#new-proto-name").fill("uart");
  await modal.locator("#new-proto-full-name").fill("Universal async");
  await modal.locator("#new-proto-leaf").check();
  await modal.getByRole("button", { name: "Create Protocol" }).click();
  await expect(modal).toBeHidden();

  await expect(page).toHaveURL(
    `/projects/${id}/inventory?tab=protocols&protocol=uart`,
  );
  await expect
    .poll(async () => modelFile(page), { timeout: 10_000 })
    .toMatch(/protocol "uart" \{[\s\S]*leaf\s*=\s*true/);
});

test("the protocol overview edits full name, leaf and encapsulates in the file", async ({
  page,
}) => {
  const id = await seededProject(page, "E2E protocols overview");
  await openProtocol(page, id, "power");
  const pane = page.getByTestId("protocol-detail-pane");

  await pane.getByLabel("Full name").fill("DC power delivery");
  await pane.getByLabel("Full name").press("Tab");
  await expect
    .poll(() => modelFile(page), { timeout: 10_000 })
    .toContain('full_name = "DC power delivery"');

  await pane.getByLabel("Leaf").check();
  await expect
    .poll(() => modelFile(page), { timeout: 10_000 })
    .toMatch(/protocol "power" \{[\s\S]*leaf\s*=\s*true/);

  await pane.getByRole("checkbox", { name: "bus" }).check();
  await expect
    .poll(() => modelFile(page), { timeout: 10_000 })
    .toMatch(/encapsulates\s*=\s*\["bus"\]/);
});

test("an encapsulates cycle is refused with a toast and writes nothing", async ({
  page,
}) => {
  const id = await seededProject(page, "E2E protocols cycle");
  // power -> bus first, so the reverse edge closes a cycle.
  await openProtocol(page, id, "power");
  await page
    .getByTestId("protocol-detail-pane")
    .getByRole("checkbox", { name: "bus" })
    .check();
  await expect
    .poll(() => modelFile(page), { timeout: 10_000 })
    .toMatch(/encapsulates\s*=\s*\["bus"\]/);

  const before = await modelFile(page);
  await openProtocol(page, id, "bus");
  const carries = page
    .getByTestId("protocol-detail-pane")
    .getByRole("checkbox", { name: "power" });
  await carries.click();

  await expect(page.getByText(/Change refused/)).toBeVisible();
  // The refused box is put back to the model's value, and nothing is written.
  await expect(carries).not.toBeChecked();
  expect(await modelFile(page)).toBe(before);
});

test("a used protocol cannot be deleted until its usages are removed", async ({
  page,
}) => {
  const id = await seededProject(page, "E2E protocols delete");
  await openProtocol(page, id, "power");
  const pane = page.getByTestId("protocol-detail-pane");
  await pane.getByRole("tab", { name: "Delete" }).click();

  // While usages remain, the confirmation is disabled and its input locked.
  const confirm = pane.getByTestId("protocol-delete-confirm");
  await expect(confirm).toBeDisabled();
  await expect(pane.getByLabel(/type "power" to confirm/i)).toBeDisabled();

  const blockers = pane.getByTestId("inventory-delete-blockers");
  await expect(blockers).toContainText("battery");
  await expect(blockers).toContainText("out");

  // Remove the port by deleting the battery component, then delete the protocol.
  await page.goto(`/projects/${id}/inventory/battery`);
  await page.getByRole("tab", { name: "Delete" }).click();
  await page
    .getByTestId("inventory-detail-pane")
    .getByLabel(/type "battery" to confirm/i)
    .fill("battery");
  await page
    .getByTestId("inventory-detail-pane")
    .getByTestId("inventory-delete-confirm")
    .click();
  await expect
    .poll(() => modelFile(page), { timeout: 10_000 })
    .not.toContain('component "battery"');

  await openProtocol(page, id, "power");
  await page
    .getByTestId("protocol-detail-pane")
    .getByRole("tab", { name: "Delete" })
    .click();
  await page
    .getByTestId("protocol-detail-pane")
    .getByLabel(/type "power" to confirm/i)
    .fill("power");
  await page.getByTestId("protocol-delete-confirm").click();

  await expect
    .poll(() => modelFile(page), { timeout: 10_000 })
    .not.toContain('protocol "power"');
  await expect(page).toHaveURL(`/projects/${id}/inventory?tab=protocols`);
});

test("the protocol deep link survives a reload, and an unknown label is ignored", async ({
  page,
}) => {
  const id = await seededProject(page, "E2E protocols deep link");
  await openProtocol(page, id, "bus");
  await page.reload();
  await expect(page.getByRole("tab", { name: "Protocols" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    page.getByTestId("protocol-detail-pane").getByRole("heading", {
      name: "bus",
    }),
  ).toBeVisible();

  await page.goto(`/projects/${id}/inventory?tab=protocols&protocol=nope`);
  await expect(page.getByRole("tab", { name: "Protocols" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  // Nothing opens, and the pane says how to open one.
  await expect(
    page.getByText("Select a protocol in the Inventory Browser to inspect it."),
  ).toBeVisible();
  await expect(page.getByText(/Something went wrong/i)).toHaveCount(0);
});
