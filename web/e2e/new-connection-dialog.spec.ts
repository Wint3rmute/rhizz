import { expect, type Page, test } from "@playwright/test";
import { createNewProject, replaceModel, storedFiles } from "./helpers";

// Dragging an arrow between two components opens the "New connection" dialog,
// which creates the connection together with one new port on each end. Pins
// the interaction: what Enter and Esc do, what the protocol picker offers, and
// what lands in the model file.
const MODEL = `protocol "spi" {
  roles = ["provider", "consumer"]
}

component "alpha" {
  leaf = true
}

component "beta" {
  leaf = true
}

system "demo" {
  instance "alpha" { source = "alpha" }
  instance "beta" { source = "beta" }
}
`;

async function modelText(page: Page): Promise<string> {
  const files = await storedFiles(page);
  return files["main.hcl"] ?? files["system.hcl"] ?? "";
}

// Opens the diagram with both components placed side by side, so a handle
// drag from one lands on the other.
async function openDiagram(
  page: Page,
  name: string,
  model = MODEL,
): Promise<void> {
  const id = await createNewProject(page, name);
  await replaceModel(page, model);
  await page.goto(`/projects/${id}/modeling`);
  await expect(page.getByTestId("diagram-toolbar")).toBeVisible();

  const tree = page.getByTestId("modeling-pane-right");
  for (const label of ["alpha", "beta"]) {
    await tree
      .locator("li", { hasText: label })
      .first()
      .getByRole("checkbox")
      .check();
  }
  // Both land on the same spot; move beta aside.
  await tree.getByRole("button", { name: "beta", exact: true }).click();
  for (let i = 0; i < 12; i++) await page.keyboard.press("ArrowRight");
}

async function drawAlphaToBeta(page: Page): Promise<void> {
  const canvas = page.getByTestId("diagram-canvas");
  await page
    .getByTestId("modeling-pane-right")
    .getByRole("button", { name: "alpha", exact: true })
    .click();
  const handle = canvas.getByTestId("diagram-side-handle").first();
  await expect(handle).toBeVisible();
  const handleBox = await handle.boundingBox();
  if (!handleBox) throw new Error("no handle box");
  const betaBox = await canvas
    .getByText("beta", { exact: true })
    .first()
    .boundingBox();
  if (!betaBox) throw new Error("no box for beta");
  await page.mouse.move(
    handleBox.x + handleBox.width / 2,
    handleBox.y + handleBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    betaBox.x + betaBox.width / 2,
    betaBox.y + betaBox.height / 2,
    { steps: 8 },
  );
  await page.mouse.up();
  // Ready means the name is focused: that is what makes Enter work.
  await expect(page.getByTestId("new-connection-name")).toBeFocused();
}

test("Enter creates the connection with the prefilled ports", async ({
  page,
}) => {
  await openDiagram(page, "E2E new connection defaults");
  await drawAlphaToBeta(page);

  const dialog = page.getByTestId("new-connection-modal");
  await expect(dialog).toBeVisible();
  // The connection name is focused and prefilled, so Enter is all it takes.
  const name = dialog.getByTestId("new-connection-name");
  await expect(name).toBeFocused();
  await expect(name).toHaveValue("alpha-to-beta");
  await expect(dialog.getByTestId("new-connection-from-name")).toHaveValue(
    "link-beta",
  );
  await expect(dialog.getByTestId("new-connection-to-name")).toHaveValue(
    "link-alpha",
  );
  await expect(dialog.getByTestId("new-connection-protocol")).toHaveValue("");
  // The flags are plain fields of each port, not hidden behind a toggle.
  await expect(
    dialog.getByTestId("new-connection-from-external"),
  ).not.toBeChecked();
  await expect(
    dialog.getByTestId("new-connection-from-required"),
  ).toBeChecked();

  // The preview names the connection under its line, live.
  const previewName = dialog.getByTestId("new-connection-preview-name");
  await expect(previewName).toHaveText("alpha-to-beta");
  await name.fill("power");
  await expect(previewName).toHaveText("power");
  await name.fill("alpha-to-beta");

  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();

  await expect
    .poll(async () => modelText(page), { timeout: 10_000 })
    .toContain('connection "alpha-to-beta"');
  const model = await modelText(page);
  expect(model).toContain('port "link-beta"');
  expect(model).toContain('port "link-alpha"');
  // Sibling ports are internal, required by default, with no role or protocol.
  expect(model).not.toContain("external");
  expect(model).not.toMatch(/role\s*=/);
  expect(model).not.toMatch(/protocol\s*=/);
  await expect(
    page.getByTestId("diagram-canvas").getByTestId("diagram-edge"),
  ).toHaveCount(1);
});

test("Escape creates nothing", async ({ page }) => {
  await openDiagram(page, "E2E new connection cancel");
  await drawAlphaToBeta(page);

  const dialog = page.getByTestId("new-connection-modal");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  const model = await modelText(page);
  expect(model).not.toContain("connection ");
  expect(model).not.toContain("port ");
});

test("undo removes the connection and its ports in one step", async ({
  page,
}) => {
  await openDiagram(page, "E2E new connection undo");
  await drawAlphaToBeta(page);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("new-connection-modal")).toBeHidden();
  await expect
    .poll(async () => modelText(page), { timeout: 10_000 })
    .toContain('connection "alpha-to-beta"');

  await page.keyboard.press("Control+z");
  await expect
    .poll(async () => modelText(page), { timeout: 10_000 })
    .not.toContain("alpha-to-beta");
  const model = await modelText(page);
  expect(model).not.toContain("link-beta");
  expect(model).not.toContain("link-alpha");

  await page.keyboard.press("Control+y");
  await expect
    .poll(async () => modelText(page), { timeout: 10_000 })
    .toContain('connection "alpha-to-beta"');
  expect(await modelText(page)).toContain('port "link-beta"');
});

test("a protocol with roles offers them and writes the typed ports", async ({
  page,
}) => {
  await openDiagram(page, "E2E new connection typed");
  await drawAlphaToBeta(page);

  const dialog = page.getByTestId("new-connection-modal");
  await dialog.getByTestId("new-connection-protocol").click();
  await dialog
    .getByTestId("new-connection-protocol-option")
    .filter({ hasText: "spi" })
    .click();
  await expect(dialog.getByTestId("new-connection-protocol")).toHaveValue(
    "spi",
  );

  // The protocol's roles are preselected, source first.
  const fromRole = dialog.getByTestId("new-connection-from-role");
  const toRole = dialog.getByTestId("new-connection-to-role");
  await expect(fromRole).toHaveValue("provider");
  await expect(toRole).toHaveValue("consumer");
  await fromRole.selectOption("consumer");
  await toRole.selectOption("provider");

  await dialog.getByTestId("new-connection-create").click();
  await expect(dialog).toBeHidden();

  await expect
    .poll(async () => modelText(page), { timeout: 10_000 })
    .toContain('connection "alpha-to-beta"');
  const model = await modelText(page);
  expect(model.match(/protocol\s*=\s*"spi"/g)).toHaveLength(2);
  expect(model).toMatch(/role\s*=\s*"consumer"/);
  expect(model).toMatch(/role\s*=\s*"provider"/);
});

test("a protocol that does not exist yet is created with the connection", async ({
  page,
}) => {
  await openDiagram(page, "E2E new connection new protocol");
  await drawAlphaToBeta(page);

  const dialog = page.getByTestId("new-connection-modal");
  const protocol = dialog.getByTestId("new-connection-protocol");
  await protocol.fill("uart");
  await dialog
    .getByTestId("new-connection-protocol-option")
    .filter({ hasText: "Create protocol" })
    .click();
  await expect(
    dialog.getByTestId("new-connection-protocol-hint"),
  ).toContainText("will be created");
  // A fresh protocol defines no roles, so there is nothing to choose from.
  const fromRole = dialog.getByTestId("new-connection-from-role");
  await expect(fromRole).toBeDisabled();
  await expect(fromRole).toContainText("No roles defined");

  await dialog.getByTestId("new-connection-create").click();
  await expect(dialog).toBeHidden();

  await expect
    .poll(async () => modelText(page), { timeout: 10_000 })
    .toContain('protocol "uart"');
  const model = await modelText(page);
  expect(model.match(/protocol\s*=\s*"uart"/g)).toHaveLength(2);
});

test("the protocol list is driven from the keyboard", async ({ page }) => {
  await openDiagram(page, "E2E new connection keyboard");
  await drawAlphaToBeta(page);

  const dialog = page.getByTestId("new-connection-modal");
  const protocol = dialog.getByTestId("new-connection-protocol");
  await protocol.focus();
  await expect(
    dialog.getByTestId("new-connection-protocol-list"),
  ).toBeVisible();
  await page.keyboard.press("ArrowDown");
  // Enter picks the highlighted option instead of creating the connection.
  await page.keyboard.press("Enter");
  await expect(protocol).toHaveValue("spi");
  await expect(dialog).toBeVisible();

  // Escape closes the list first, the dialog only on the second press.
  await page.keyboard.press("ArrowDown");
  await expect(
    dialog.getByTestId("new-connection-protocol-list"),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog.getByTestId("new-connection-protocol-list")).toBeHidden();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("a role can be typed without a protocol", async ({ page }) => {
  await openDiagram(page, "E2E new connection free role");
  await drawAlphaToBeta(page);

  const dialog = page.getByTestId("new-connection-modal");
  await dialog.getByTestId("new-connection-from-role").fill("master");
  await dialog.getByTestId("new-connection-create").click();
  await expect(dialog).toBeHidden();

  await expect
    .poll(async () => modelText(page), { timeout: 10_000 })
    .toMatch(/role\s*=\s*"master"/);
});

test("a port name the component already has is refused", async ({ page }) => {
  await openDiagram(
    page,
    "E2E new connection port clash",
    MODEL.replace(
      'component "beta" {\n  leaf = true\n}',
      'component "beta" {\n  leaf = true\n  port "link-alpha" {}\n}',
    ),
  );
  await drawAlphaToBeta(page);

  // The prefilled name already steps around the existing port.
  const dialog = page.getByTestId("new-connection-modal");
  const toName = dialog.getByTestId("new-connection-to-name");
  await expect(toName).toHaveValue("link-alpha-2");
  await expect(dialog.getByTestId("new-connection-create")).toBeEnabled();

  // Typing the name that exists disables Create and says why.
  await toName.fill("link-alpha");
  await expect(dialog.getByTestId("new-connection-problem")).toContainText(
    "already exists",
  );
  await expect(dialog.getByTestId("new-connection-create")).toBeDisabled();
});
