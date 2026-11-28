import { expect, type Page, test } from "@playwright/test";
import { createNewProject, replaceModel, storedFiles } from "./helpers";

// Renaming a port from the Node Inspector renames it in the model, rewrites the
// connection that ends on it, and keeps its per-view state (outline spot,
// shown flag) in every view, the open one and the others. One undo step puts
// it all back.
const MODEL = `component "router" {
  leaf = true
  port "link-thinkcentre" {}
  port "wifi" {}
}

component "thinkcentre" {
  leaf = true
  port "eth" {}
}

system "homelab" {
  instance "router" { source = "router" }
  instance "thinkcentre" { source = "thinkcentre" }

  connection "ethernet" {
    from = "thinkcentre/eth"
    to   = "router/link-thinkcentre"
  }
}
`;

// A second view, not the one the canvas opens, that pins the port's spot.
const OTHER_VIEW = `view "other" {
  system = "homelab"

  node "homelab/router" {
    x = 0
    y = 0

    port "link-thinkcentre" {
      side   = "left"
      offset = 0.25
    }
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

test("renaming a connected port keeps its connection, views and undo", async ({
  page,
}) => {
  const id = await createNewProject(page, "E2E port rename");
  await replaceModel(page, MODEL);
  await seedView(page, id, "other.hcl", OTHER_VIEW);
  await seedView(
    page,
    id,
    "main.hcl",
    'view "main" {\n  system = "homelab"\n}\n',
  );
  // Open `main.hcl`, so `other.hcl` is a view the canvas does not show.
  await page.goto(`/projects/${id}/modeling/main.hcl`);
  await expect(page.getByTestId("diagram-toolbar")).toBeVisible();

  const tree = page.getByTestId("modeling-pane-right");
  const canvas = page.getByTestId("diagram-canvas");
  for (const name of ["router", "thinkcentre"]) {
    // By exact button name: router's row also contains "link-thinkcentre".
    // The innermost matching row is the component's own.
    await tree
      .locator("li")
      .filter({ has: page.getByRole("button", { name, exact: true }) })
      .last()
      .getByRole("checkbox")
      .first()
      .check();
  }
  await expect(
    canvas.getByText("link-thinkcentre", { exact: true }),
  ).toBeVisible();
  // Show the unconnected port, so its shown flag has to follow a rename.
  await tree.getByRole("button", { name: "Show port wifi" }).click();
  await expect(canvas.getByText("wifi", { exact: true })).toBeVisible();

  await tree.getByRole("button", { name: "router", exact: true }).click();
  const names = page.getByRole("textbox", { name: "Port name" });
  const link = names.nth(0);
  const wifi = names.nth(1);
  await expect(link).toHaveValue("link-thinkcentre");

  // The connected port: the edge stays drawn under the new name.
  await link.fill("uplink");
  await link.press("Enter");
  await expect(canvas.getByText("uplink", { exact: true })).toBeVisible();
  await expect(
    canvas.getByText("link-thinkcentre", { exact: true }),
  ).toHaveCount(0);
  await expect
    .poll(() => modelFile(page))
    .toContain('"/homelab/router/uplink"');
  // The other view's pinned spot follows the rename.
  await expect
    .poll(() => fileEnding(page, "views/other.hcl"))
    .toContain('port "uplink"');
  expect(await fileEnding(page, "views/other.hcl")).not.toContain(
    "link-thinkcentre",
  );

  // A taken name is refused inline and writes nothing; Escape puts it back.
  const before = await modelFile(page);
  await wifi.fill("uplink");
  await wifi.press("Enter");
  await expect(page.getByTestId("port-name-error")).toHaveText(
    "A port named “uplink” already exists.",
  );
  expect(await modelFile(page)).toBe(before);
  await wifi.focus();
  await wifi.press("Escape");
  await expect(wifi).toHaveValue("wifi");
  await expect(page.getByTestId("port-name-error")).toHaveCount(0);

  // The shown unconnected port stays shown under its new name.
  await wifi.fill("wlan");
  await wifi.press("Enter");
  await expect(canvas.getByText("wlan", { exact: true })).toBeVisible();
  await expect(
    tree.getByRole("button", { name: "Show port wlan" }),
  ).toHaveAttribute("aria-pressed", "true");

  // One undo per rename restores the model and the other view.
  await canvas.click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Control+z");
  await expect(canvas.getByText("wifi", { exact: true })).toBeVisible();
  await page.keyboard.press("Control+z");
  await expect(
    canvas.getByText("link-thinkcentre", { exact: true }),
  ).toBeVisible();
  // Undo puts back the exact bytes the model had before the first rename.
  await expect.poll(() => modelFile(page)).toBe(MODEL);
  await expect.poll(() => fileEnding(page, "views/other.hcl")).toBe(OTHER_VIEW);
});
