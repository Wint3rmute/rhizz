import { expect, type Page, test } from "@playwright/test";
import { createNewProject, replaceModel, storedFiles } from "./helpers";

// Renaming a connection from the Connection Inspector renames its HCL label,
// rewrites the `realized_by` entries that name it, and keeps its per-view
// hidden state in every view, the open one and the others. One undo step puts
// it all back.
const MODEL = `component "box" {
  leaf = true
  port "p" {}
  port "q" {}
}

system "home" {
  instance "a" { source = "box" }
  instance "b" { source = "box" }

  connection "ethernet" {
    from = "a/p"
    to   = "b/p"
  }

  connection "app" {
    from        = "a/q"
    to          = "b/q"
    realized_by = ["ethernet"]
  }
}
`;

// A second view, not the one the canvas opens, that hides the connection.
const OTHER_VIEW = `view "other" {
  system = "home"

  connection "ethernet" {
    hidden = true
  }
}
`;

const VFS_KEY = "rhizome:vfs:v1";

/** Adds `views/<name>` to project `projectId` before the page loads it. */
async function seedView(
  page: Page,
  projectId: string,
  name: string,
  content: string,
): Promise<void> {
  await page.evaluate(
    ({ key, projectId, name, content }) => {
      const raw = window.localStorage.getItem(key);
      if (raw === null) throw new Error("no VFS in localStorage");
      const blob = JSON.parse(raw) as {
        nodes: Record<string, unknown>[];
      };
      let views = blob.nodes.find(
        (n) =>
          n.projectId === projectId &&
          n.kind === "directory" &&
          n.parentId === null &&
          n.name === "views",
      );
      if (views === undefined) {
        views = {
          id: `${projectId}-e2e-views`,
          projectId,
          parentId: null,
          name: "views",
          kind: "directory",
        };
        blob.nodes.push(views);
      }
      blob.nodes.push({
        id: `${projectId}-e2e-${name}`,
        projectId,
        parentId: views.id,
        name,
        kind: "file",
        content,
        revision: 0,
        updatedAt: new Date().toISOString(),
      });
      window.localStorage.setItem(key, JSON.stringify(blob));
    },
    { key: VFS_KEY, projectId, name, content },
  );
}

/** The stored content of the first file whose path ends with `suffix`. */
async function fileEnding(page: Page, suffix: string): Promise<string> {
  const files = await storedFiles(page);
  const entry = Object.entries(files).find(([path]) => path.endsWith(suffix));
  return entry?.[1] ?? "";
}

/** The model file (the project's top-level `.hcl` source). */
async function modelFile(page: Page): Promise<string> {
  const files = await storedFiles(page);
  const entry = Object.entries(files).find(
    ([path]) => !path.includes("views/") && path.endsWith(".hcl"),
  );
  return entry?.[1] ?? "";
}

test("renaming a connection keeps its realizations, views and undo", async ({
  page,
}) => {
  const id = await createNewProject(page, "E2E connection rename");
  await replaceModel(page, MODEL);
  await seedView(page, id, "other.hcl", OTHER_VIEW);
  await seedView(page, id, "main.hcl", 'view "main" {\n  system = "home"\n}\n');
  // Open `main.hcl`, so `other.hcl` is a view the canvas does not show.
  await page.goto(`/projects/${id}/modeling/main.hcl`);
  await expect(page.getByTestId("diagram-toolbar")).toBeVisible();

  const tree = page.getByTestId("modeling-pane-right");
  const canvas = page.getByTestId("diagram-canvas");
  for (const name of ["a", "b"]) {
    await tree
      .locator("li")
      .filter({ has: page.getByRole("button", { name, exact: true }) })
      .last()
      .getByRole("checkbox")
      .first()
      .check();
  }
  // Both land on the same spot; move b aside so the edges are clickable.
  await tree.getByRole("button", { name: "b", exact: true }).click();
  for (let i = 0; i < 12; i++) await page.keyboard.press("ArrowRight");

  const edge = canvas
    .getByTestId("diagram-edge")
    .filter({ hasText: "ethernet" })
    .first();
  await expect(edge).toBeVisible();
  await edge.click({ force: true });
  const inspector = page.getByTestId("connection-inspector");
  const name = inspector.getByLabel("Connection name");
  await expect(name).toHaveValue("ethernet");

  // A taken name is refused inline and writes nothing; Escape puts it back.
  const before = await modelFile(page);
  await name.fill("app");
  await name.press("Enter");
  await expect(page.getByTestId("connection-name-error")).toHaveText(
    "A connection named “app” already exists.",
  );
  expect(await modelFile(page)).toBe(before);
  await name.focus();
  await name.press("Escape");
  await expect(name).toHaveValue("ethernet");
  await expect(page.getByTestId("connection-name-error")).toHaveCount(0);

  // The rename: the edge stays drawn and selected under its new name.
  await name.fill("lan");
  await name.press("Enter");
  await expect(name).toHaveValue("lan");
  await expect(
    canvas.getByTestId("diagram-edge").filter({ hasText: "lan" }),
  ).toBeVisible();
  await expect.poll(() => modelFile(page)).toContain('connection "lan"');
  const renamed = await modelFile(page);
  expect(renamed).toContain('realized_by  = ["lan"]');
  expect(renamed).not.toContain("ethernet");
  // The other view's hidden flag follows the rename.
  await expect
    .poll(() => fileEnding(page, "views/other.hcl"))
    .toContain('connection "lan"');
  expect(await fileEnding(page, "views/other.hcl")).not.toContain("ethernet");

  // Hidden in the open view, it stays hidden under its next name.
  await tree.getByRole("checkbox", { name: "Show connection lan" }).uncheck();
  await expect(name).toHaveValue("lan");
  await name.fill("wire");
  await name.press("Enter");
  await expect(
    tree.getByRole("checkbox", { name: "Show connection wire" }),
  ).not.toBeChecked();
  await expect
    .poll(() => fileEnding(page, "views/main.hcl"))
    .toContain('connection "wire"');

  // Undo the second rename, the hide, then the first rename: the model and
  // the other view are back to their bytes from before.
  await canvas.click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Control+z");
  await expect(
    tree.getByRole("checkbox", { name: "Show connection lan" }),
  ).toBeVisible();
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+z");
  await expect(
    tree.getByRole("checkbox", { name: "Show connection ethernet" }),
  ).toBeChecked();
  await expect.poll(() => modelFile(page)).toBe(before);
  expect(await fileEnding(page, "views/other.hcl")).toBe(OTHER_VIEW);
});

// Names are unique within a system, not across systems: with a `link` in
// both, the inspector edits the one the open view's system draws.
const TWO_SYSTEMS = `component "box" {
  leaf = true
  port "p" {}
}

system "alpha" {
  instance "a1" { source = "box" }
  instance "a2" { source = "box" }

  connection "link" {
    full_name = "Alpha link"
    from      = "a1/p"
    to        = "a2/p"
  }
}

system "beta" {
  instance "b1" { source = "box" }
  instance "b2" { source = "box" }

  connection "link" {
    full_name = "Beta link"
    from      = "b1/p"
    to        = "b2/p"
  }
}
`;

test("the inspector shows and renames the open view's own connection", async ({
  page,
}) => {
  const id = await createNewProject(page, "E2E same-named connections");
  await replaceModel(page, TWO_SYSTEMS);
  await seedView(page, id, "beta.hcl", 'view "beta" {\n  system = "beta"\n}\n');
  await page.goto(`/projects/${id}/modeling/beta.hcl`);
  await expect(page.getByTestId("diagram-toolbar")).toBeVisible();

  const tree = page.getByTestId("modeling-pane-right");
  for (const name of ["b1", "b2"]) {
    await tree
      .locator("li")
      .filter({ has: page.getByRole("button", { name, exact: true }) })
      .last()
      .getByRole("checkbox")
      .first()
      .check();
  }
  await tree.getByRole("button", { name: "b2", exact: true }).click();
  for (let i = 0; i < 12; i++) await page.keyboard.press("ArrowRight");

  await page
    .getByTestId("diagram-canvas")
    .getByTestId("diagram-edge")
    .filter({ hasText: "link" })
    .first()
    .click({ force: true });
  const inspector = page.getByTestId("connection-inspector");
  await expect(inspector.getByLabel("Full name")).toHaveValue("Beta link");

  const name = inspector.getByLabel("Connection name");
  await name.fill("beta-link");
  await name.press("Enter");
  await expect(name).toHaveValue("beta-link");
  await expect.poll(() => modelFile(page)).toContain('connection "beta-link"');
  const model = await modelFile(page);
  // Alpha's `link` keeps its name.
  expect(model).toMatch(/connection "link" \{\s+full_name\s+= "Alpha link"/);
});
