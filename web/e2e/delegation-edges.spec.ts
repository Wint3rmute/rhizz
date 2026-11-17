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

// Alt-dragging from an existing boundary dot into a child opens the dialog
// in delegation mode: the outer end is the scope itself, so it inherits.
// The outside edge exists first (as in the real flow), so the api dot renders.
const DIALOG_MODEL = `component "leaf" {
  leaf = true
  port "http" {
    protocol = "sig"
  }
}
component "svc" {
  port "api" { external = true }
  instance "proxy" { source = "leaf" }
}
component "user" {
  leaf = true
  port "out" { protocol = "sig" }
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

test("the new-connection dialog offers a delegation variant for the scope itself", async ({
  page,
}) => {
  const id = await createNewProject(page, "E2E delegation dialog");
  await replaceModel(page, DIALOG_MODEL);
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
  await tree.getByRole("button", { name: "Expand all" }).click();
  await place("proxy");
  // Select svc so its boundary dot renders.
  await tree.getByRole("button", { name: "svc", exact: true }).click();
  // Alt-drag from the existing boundary dot into the child, exactly the
  // gesture that discovers delegation: the outer end is the scope itself.
  const dot = canvas.getByTestId("diagram-port").filter({ hasText: "api" });
  await expect(dot).toBeVisible();
  const start = await dot.locator("circle").first().boundingBox();
  if (!start) throw new Error("no boundary port dot box");
  const proxyBox = await canvas
    .getByText("proxy", { exact: true })
    .first()
    .boundingBox();
  if (!proxyBox) throw new Error("no box for proxy");
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.keyboard.down("Alt");
  await page.mouse.down();
  await page.mouse.move(
    proxyBox.x + proxyBox.width / 2,
    proxyBox.y + proxyBox.height / 2,
    { steps: 8 },
  );
  await page.mouse.up();
  await page.keyboard.up("Alt");

  const dialog = page.getByTestId("new-connection-modal");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("new-connection-delegation")).toContainText(
    /delegates inward/i,
  );
  // The outer end inherits: no role field, existing port named.
  await expect(dialog.getByTestId("new-connection-from-role")).toHaveCount(0);
  await expect(
    dialog.getByTestId("new-connection-existing-port"),
  ).toContainText("api");
  // The inner end still takes a role.
  await expect(dialog.getByTestId("new-connection-to-role")).toBeVisible();

  // Create with the defaults: blank protocol, blank role.
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();

  // The delegation edge draws without an arrowhead; the outside edge keeps its.
  await expect(canvas.getByTestId("diagram-edge")).toHaveCount(2);
  await expect(
    canvas.getByTestId("diagram-edge").locator("polygon"),
  ).toHaveCount(1);

  // The model names the scope's own port with `./` and leaves it untyped.
  const modelText = async (): Promise<string> => {
    const files = await storedFiles(page);
    return files["system.hcl"] ?? files["main.hcl"] ?? "";
  };
  await expect
    .poll(() => modelText(page), { timeout: 10_000 })
    .toContain('"./api"');
});

// Side-handle drag from a parent onto its nested child opens the same
// delegation dialog (regression: this gesture once locked the canvas with
// `effect_update_depth_exceeded` and no dialog). The top handle is used on
// purpose: the parent's existing boundary dot sits on another side and
// would win the hit-test there (starting a port move, not a connection).
test("a parent side-handle drop onto its nested child delegates inward", async ({
  page,
}) => {
  const pageerrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (err) => pageerrors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  const id = await createNewProject(page, "E2E delegation side-handle drop");
  await replaceModel(page, DIALOG_MODEL);
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
  // Spread apart so the dragged handle starts clear of the other node.
  await tree.getByRole("button", { name: "user", exact: true }).click();
  for (let i = 0; i < 12; i++) await page.keyboard.press("ArrowLeft");
  await tree.getByRole("button", { name: "svc", exact: true }).click();
  for (let i = 0; i < 12; i++) await page.keyboard.press("ArrowRight");
  await tree.getByRole("button", { name: "Expand all" }).click();
  await place("proxy");
  // Select svc so its side handles render.
  await tree.getByRole("button", { name: "svc", exact: true }).click();

  // Top side handle: `computeDirectionalHandles` renders top first, and the
  // existing `api` boundary dot sits on another side.
  const handle = canvas.getByTestId("diagram-side-handle").nth(0);
  await expect(handle).toBeVisible();
  const handleBox = await handle.boundingBox();
  if (!handleBox) throw new Error("no side-handle box");
  const proxyBox = await canvas
    .getByText("proxy", { exact: true })
    .first()
    .boundingBox();
  if (!proxyBox) throw new Error("no box for proxy");
  await page.mouse.move(
    handleBox.x + handleBox.width / 2,
    handleBox.y + handleBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    proxyBox.x + proxyBox.width / 2,
    proxyBox.y + proxyBox.height / 2,
    { steps: 12 },
  );
  await page.mouse.up();

  const dialog = page.getByTestId("new-connection-modal");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("new-connection-delegation")).toContainText(
    /delegates inward/i,
  );
  // The outer end is new (side-handle, not a port dot): it inherits.
  await expect(dialog.getByTestId("new-connection-from-role")).toHaveCount(0);

  // Closing the dialog must not throw either (the focus effect's
  // `bind:this` is `null` once unmounted).
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  expect([...pageerrors, ...consoleErrors].join("\n")).not.toContain(
    "effect_update_depth",
  );
  expect([...pageerrors, ...consoleErrors].join("\n")).not.toContain("closest");
});
