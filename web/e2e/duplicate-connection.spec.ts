import { expect, test } from "@playwright/test";
import { createNewProject } from "./helpers";

const VFS_KEY = "rhizz:vfs:v1";

/** Every file in the VFS, keyed by its project-relative path. */
async function storedFiles(page: import("@playwright/test").Page) {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    if (raw === null) throw new Error("no VFS in localStorage");
    const blob = JSON.parse(raw) as {
      nodes: {
        id: string;
        parentId: string | null;
        name: string;
        kind: string;
        content?: string;
      }[];
    };
    const pathOf = (node: (typeof blob.nodes)[number]): string => {
      const parts = [node.name];
      let parent = node.parentId;
      while (parent !== null) {
        const found = blob.nodes.find((n) => n.id === parent);
        if (found === undefined) break;
        parts.unshift(found.name);
        parent = found.parentId;
      }
      return parts.join("/");
    };
    const files: Record<string, string> = {};
    for (const node of blob.nodes) {
      if (node.kind !== "file") continue;
      files[pathOf(node)] = node.content ?? "";
    }
    return files;
  }, VFS_KEY);
}

// Two connections with the same name in one scope: the second draw must be
// refused with a message, not silently swallowed (or worse, replacing the
// first). Drives the real canvas flow — drag handle to node, name prompt —
// and reads the model file back, so it pins the outcome, not the control.
test("a duplicate connection name is refused with a message", async ({ page }) => {
  const id = await createNewProject(page, "E2E duplicate connection");

  // Three components on the default view: the creation modal places each
  // one, so all three are drawn and connectable without touching the tree.
  await page.goto(`/projects/${id}/modeling`);
  await expect(page.getByTestId("diagram-toolbar")).toBeVisible();
  const canvasBox = await page.getByTestId("diagram-canvas").boundingBox();
  if (!canvasBox) throw new Error("no canvas box");
  // Clicking empty canvas clears the selection — and creating with a node
  // selected would parent the new component under it instead of placing a
  // flat sibling. The corner is safely away from the viewport-center spawn.
  const emptySpot = {
    x: canvasBox.x + canvasBox.width - 60,
    y: canvasBox.y + canvasBox.height - 60,
  };
  for (const name of ["conn-a", "conn-b", "conn-c"]) {
    await page.mouse.click(emptySpot.x, emptySpot.y);
    await page.getByRole("button", { name: "+ Component" }).click();
    const modal = page.getByTestId("create-component-modal");
    await expect(modal).toBeVisible();
    await modal.locator("#new-comp-name").fill(name);
    await modal.getByRole("button", { name: "Create Definition" }).click();
    await expect(modal).toBeHidden();
  }

  const canvas = page.getByTestId("diagram-canvas");

  // The tree panel selects nodes by row click (canvas clicks hit the
  // topmost of the stacked nodes, so it cannot address each one).
  const treeRow = (name: string) =>
    page.getByTestId("modeling-pane-right").getByRole("button", { name });

  async function nodeCenter(name: string): Promise<{ x: number; y: number }> {
    const box = await canvas.getByText(name, { exact: true }).first()
      .boundingBox();
    if (!box) throw new Error(`no box for ${name}`);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }

  // Fresh components stack on the same spot: select each via its tree row
  // and nudge it aside with the arrow keys.
  const nudges = ["ArrowRight", "ArrowDown", "ArrowLeft"];
  let nudge = 0;
  for (const name of ["conn-a", "conn-b", "conn-c"]) {
    await treeRow(name).click();
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press(nudges[nudge % nudges.length]!);
    }
    nudge++;
  }

  async function dragConnect(from: string, to: string): Promise<void> {
    // Side handles render on the selected node only: selecting via the
    // tree row makes them the only handles on the canvas.
    await treeRow(from).click();
    const handle = canvas.getByTestId("diagram-side-handle").first();
    await expect(handle).toBeVisible();
    const handleBox = await handle.boundingBox();
    if (!handleBox) throw new Error(`no handle box for ${from}`);
    const end = await nodeCenter(to);
    await page.mouse.move(
      handleBox.x + handleBox.width / 2,
      handleBox.y + handleBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 8 });
    await page.mouse.up();
  }

  const seen: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") {
      seen.push(`console-${msg.type()}:${msg.text().slice(0, 200)}`);
    }
  });
  page.on("dialog", (dialog) => {
    seen.push(`${dialog.type()}:${dialog.message()}`);
    if (dialog.type() === "prompt") void dialog.accept("test-connection");
    else void dialog.dismiss();
  });

  await dragConnect("conn-a", "conn-b");
  await expect
    .poll(async () => {
      const files = await storedFiles(page);
      const model = files["main.hcl"] ?? files["system.hcl"] ?? "";
      return model.includes('connection "test-connection"');
    }, { timeout: 10_000 })
    .toBe(true);

  // The same name for a second connection: refused with a message naming
  // the clash, and the model keeps exactly the first connection.
  await dragConnect("conn-c", "conn-b");
  await expect
    .poll(() => Promise.resolve(seen.join("\n")), { timeout: 10_000 })
    .toMatch(/already exists/);

  const files = await storedFiles(page);
  const model = files["main.hcl"] ?? files["system.hcl"] ?? "";
  const occurrences = model.split('connection "test-connection"').length - 1;
  expect(occurrences).toBe(1);
});
