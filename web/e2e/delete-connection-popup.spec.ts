import { expect, test } from "@playwright/test";
import { createNewProject, replaceModel, storedFiles } from "./helpers";

// The "Delete connection" dialog replaces the browser prompt: it names the
// connection and both endpoints, and the port cleanup is a separate,
// unchecked-by-default choice. Connection + ports are one undoable step.

const LINKED = `component "a" {
  leaf = true

  port "out" {
  }
}

component "b" {
  leaf = true

  port "in" {
  }
}

system "main" {
  instance "a" { source = "a" }
  instance "b" { source = "b" }

  connection "link" {
    from = "a/out"
    to   = "b/in"
  }
}
`;

async function modelText(
  page: import("@playwright/test").Page,
): Promise<string> {
  const files = await storedFiles(page);
  return files["main.hcl"] ?? files["system.hcl"] ?? "";
}

async function openModeling(
  page: import("@playwright/test").Page,
  name: string,
  hcl: string,
): Promise<void> {
  const id = await createNewProject(page, name);
  await replaceModel(page, hcl);
  await page.goto(`/projects/${id}/modeling`);
  await expect(page.getByTestId("diagram-toolbar")).toBeVisible();
  // A freshly seeded view starts with nothing placed. Checking the component
  // rows places them, which makes the connection appear in the sidebar (a
  // connection is only listed when both endpoints are placed).
  const boxes = page
    .getByTestId("modeling-pane-right")
    .locator('li input[type="checkbox"]');
  for (let i = 0; i < (await boxes.count()); i++) {
    const box = boxes.nth(i);
    if (!(await box.isChecked())) await box.check();
  }
}

async function openDeleteDialog(page: import("@playwright/test").Page) {
  const row = page.getByTestId("connection-row-link");
  await expect(row).toBeVisible();
  await row.hover();
  await row.getByRole("button", { name: "Delete connection link" }).click();
  const modal = page.getByTestId("delete-connection-modal");
  await expect(modal).toBeVisible();
  return modal;
}

test("the popup names the connection and its endpoints, with cleanup off", async ({
  page,
}) => {
  await openModeling(page, "E2E delete connection popup", LINKED);
  const modal = await openDeleteDialog(page);

  await expect(modal.getByTestId("delete-connection-label")).toHaveText("link");
  await expect(modal.getByTestId("delete-connection-from")).toHaveText("a");
  await expect(modal.getByTestId("delete-connection-to")).toHaveText("b");
  await expect(modal.getByTestId("delete-connection-ports")).toContainText(
    "out",
  );
  await expect(modal.getByTestId("delete-connection-ports")).toContainText(
    "in",
  );
  await expect(
    modal.getByTestId("delete-connection-remove-ports"),
  ).not.toBeChecked();
});

test("cancel keeps the connection; Esc closes the popup", async ({ page }) => {
  await openModeling(page, "E2E delete connection cancel", LINKED);
  const modal = await openDeleteDialog(page);
  await page.keyboard.press("Escape");
  await expect(modal).toBeHidden();
  expect(await modelText(page)).toContain('connection "link"');

  await openDeleteDialog(page);
  await page.keyboard.press("Escape");
  await expect(modal).toBeHidden();
  expect(await modelText(page)).toContain('connection "link"');
});

test("deleting without cleanup keeps the ports, and undo restores the connection", async ({
  page,
}) => {
  await openModeling(page, "E2E delete connection plain", LINKED);
  const modal = await openDeleteDialog(page);
  await modal.getByTestId("delete-connection-confirm").click();
  await expect(page.getByTestId("connection-row-link")).toBeHidden();
  await expect
    .poll(async () => (await modelText(page)).includes('connection "link"'), {
      timeout: 10_000,
    })
    .toBe(false);
  const hcl = await modelText(page);
  expect(hcl).toContain('port "out"');
  expect(hcl).toContain('port "in"');

  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("connection-row-link")).toBeVisible();
  await expect
    .poll(async () => (await modelText(page)).includes('connection "link"'), {
      timeout: 10_000,
    })
    .toBe(true);
});

test("checking the box removes the ports too, as one undoable step", async ({
  page,
}) => {
  await openModeling(page, "E2E delete connection ports", LINKED);
  const modal = await openDeleteDialog(page);
  const cleanup = modal.getByTestId("delete-connection-remove-ports");
  await cleanup.check();
  await expect(modal.getByTestId("delete-connection-port").first()).toHaveText(
    /Will be removed/,
  );
  await modal.getByTestId("delete-connection-confirm").click();

  // The removal is confirmed with a success toast; the connection name is
  // Markdown, rendered as inline code.
  const toast = page.getByRole("alert").filter({ hasText: "removed!" });
  await expect(toast).toHaveText(/connection\s+link\s+removed!/);
  await expect(toast.locator("code")).toHaveText("link");

  await expect
    .poll(
      async () => {
        const hcl = await modelText(page);
        return (
          hcl.includes('connection "link"') ||
          hcl.includes('port "out"') ||
          hcl.includes('port "in"')
        );
      },
      { timeout: 10_000 },
    )
    .toBe(false);

  // One Ctrl+Z restores the connection and both ports.
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("connection-row-link")).toBeVisible();
  await expect
    .poll(
      async () => {
        const hcl = await modelText(page);
        return (
          hcl.includes('connection "link"') &&
          hcl.includes('port "out"') &&
          hcl.includes('port "in"')
        );
      },
      { timeout: 10_000 },
    )
    .toBe(true);
});

test("Delete and Enter confirm, as the old prompt did", async ({ page }) => {
  await openModeling(page, "E2E delete connection keyboard", LINKED);
  let modal = await openDeleteDialog(page);
  await page.keyboard.press("Delete");
  await expect(modal).toBeHidden();
  await expect
    .poll(async () => (await modelText(page)).includes('connection "link"'), {
      timeout: 10_000,
    })
    .toBe(false);

  await page.keyboard.press("Control+z");
  modal = await openDeleteDialog(page);
  await page.keyboard.press("Enter");
  await expect(modal).toBeHidden();
  await expect
    .poll(async () => (await modelText(page)).includes('connection "link"'), {
      timeout: 10_000,
    })
    .toBe(false);
});

test("a shared port is refused with a clear message and nothing changes", async ({
  page,
}) => {
  await openModeling(
    page,
    "E2E delete connection shared port",
    `component "a" {
  leaf = true

  port "out" {
  }
}

component "b" {
  leaf = true

  port "in" {
  }

  port "spare" {
  }
}

system "main" {
  instance "a" { source = "a" }
  instance "b" { source = "b" }

  connection "one" {
    from = "a/out"
    to   = "b/in"
  }

  connection "two" {
    from = "a/out"
    to   = "b/spare"
  }
}
`,
  );
  const modal = page.getByTestId("delete-connection-modal");
  await expect(modal).toBeHidden();
  const row = page.getByTestId("connection-row-one");
  await row.hover();
  await row.getByRole("button", { name: "Delete connection one" }).click();
  await expect(modal).toBeVisible();
  await modal.getByTestId("delete-connection-kept-port").first().waitFor();
  await modal.getByTestId("delete-connection-remove-ports").check();
  await modal.getByTestId("delete-connection-confirm").click();

  await expect(page.getByText("Change refused")).toBeVisible();
  await expect(page.getByText(/still used by connection/)).toBeVisible();
  await expect(modal).toBeVisible();
  const hcl = await modelText(page);
  expect(hcl).toContain('connection "one"');
  expect(hcl).toContain('port "out"');
});
