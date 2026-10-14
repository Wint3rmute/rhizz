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

function viewFile(files: Record<string, string>): string {
  const entry = Object.entries(files).find(([path]) =>
    path.startsWith("views/"),
  );
  if (!entry) throw new Error(`no views file, have: ${Object.keys(files)}`);
  return entry[1]!;
}

// Hiding a connection removes it from the canvas and unchecks it in the
// sidebar; the state survives reload; unchecking and re-checking an endpoint
// keeps the connection hidden; the sidebar lists exactly the placed
// connections (drawn or hidden).
test("hiding a connection removes it from the canvas and survives reload", async ({
  page,
}) => {
  const id = await createNewProject(page, "E2E connection visibility");

  await page.goto(`/projects/${id}/modeling`);
  await expect(page.getByTestId("diagram-toolbar")).toBeVisible();
  const canvasBox = await page.getByTestId("diagram-canvas").boundingBox();
  if (!canvasBox) throw new Error("no canvas box");
  const emptySpot = {
    x: canvasBox.x + canvasBox.width - 60,
    y: canvasBox.y + canvasBox.height - 60,
  };
  for (const name of ["vis-a", "vis-b", "vis-c"]) {
    await page.mouse.click(emptySpot.x, emptySpot.y);
    await page.getByRole("button", { name: "+ Component" }).click();
    const modal = page.getByTestId("create-component-modal");
    await expect(modal).toBeVisible();
    await modal.locator("#new-comp-name").fill(name);
    await modal.getByRole("button", { name: "Create Definition" }).click();
    await expect(modal).toBeHidden();
  }

  const canvas = page.getByTestId("diagram-canvas");
  const treeRow = (name: string) =>
    page.getByTestId("modeling-pane-right").getByRole("button", { name });

  async function nodeCenter(name: string): Promise<{ x: number; y: number }> {
    const box = await canvas
      .getByText(name, { exact: true })
      .first()
      .boundingBox();
    if (!box) throw new Error(`no box for ${name}`);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }

  const nudges = ["ArrowRight", "ArrowDown", "ArrowLeft"];
  let nudge = 0;
  for (const name of ["vis-a", "vis-b", "vis-c"]) {
    await treeRow(name).click();
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press(nudges[nudge % nudges.length]!);
    }
    nudge++;
  }

  const seenPrompts: string[] = [];
  page.on("dialog", (dialog) => {
    if (dialog.type() === "prompt") {
      seenPrompts.push(dialog.message());
      const next = seenPrompts.length === 1 ? "link-ab" : "link-bc";
      void dialog.accept(next);
    } else {
      void dialog.dismiss();
    }
  });

  async function dragConnect(from: string, to: string): Promise<void> {
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

  await dragConnect("vis-a", "vis-b");
  await expect
    .poll(
      async () => {
        const files = await storedFiles(page);
        const model = files["main.hcl"] ?? files["system.hcl"] ?? "";
        return model.includes('connection "link-ab"');
      },
      { timeout: 10_000 },
    )
    .toBe(true);
  // Both connections land on vis-b (the down-nudged node): drops on it hit
  // the canvas, while drops near the top edge can land under the floating
  // toolbar and never start the gesture.
  await dragConnect("vis-c", "vis-b");
  await expect
    .poll(
      async () => {
        const files = await storedFiles(page);
        const model = files["main.hcl"] ?? files["system.hcl"] ?? "";
        return model.includes('connection "link-bc"');
      },
      { timeout: 10_000 },
    )
    .toBe(true);

  // Both connections are drawn and listed, checked.
  await expect(canvas.getByTestId("diagram-edge")).toHaveCount(2);
  const rowAb = page.getByTestId("connection-row-link-ab");
  const rowBc = page.getByTestId("connection-row-link-bc");
  await expect(rowAb).toBeVisible();
  await expect(rowBc).toBeVisible();
  await expect(rowAb.getByRole("checkbox")).toBeChecked();
  await expect(rowBc.getByRole("checkbox")).toBeChecked();

  // Hiding removes it from the canvas and unchecks the sidebar row, and the
  // flag lands in the view file.
  await rowAb.getByRole("checkbox").uncheck();
  await expect(canvas.getByTestId("diagram-edge")).toHaveCount(1);
  await expect(rowAb.getByRole("checkbox")).not.toBeChecked();
  await expect
    .poll(async () => viewFile(await storedFiles(page)), { timeout: 10_000 })
    .toMatch(/hidden\s*=\s*true/);

  // Undo restores the edge and the check; redo hides it again — the toggle
  // rides the same layout undo stack as component checkboxes.
  await page.keyboard.press("Control+z");
  await expect(canvas.getByTestId("diagram-edge")).toHaveCount(2);
  await expect(rowAb.getByRole("checkbox")).toBeChecked();
  await page.keyboard.press("Control+y");
  await expect(canvas.getByTestId("diagram-edge")).toHaveCount(1);
  await expect(rowAb.getByRole("checkbox")).not.toBeChecked();

  // The state survives reload.
  await page.reload();
  await expect(page.getByTestId("diagram-toolbar")).toBeVisible();
  const canvasAfter = page.getByTestId("diagram-canvas");
  await expect(canvasAfter.getByTestId("diagram-edge")).toHaveCount(1);
  const rowAbAfter = page.getByTestId("connection-row-link-ab");
  const rowBcAfter = page.getByTestId("connection-row-link-bc");
  await expect(rowAbAfter).toBeVisible();
  await expect(rowBcAfter).toBeVisible();
  await expect(rowAbAfter.getByRole("checkbox")).not.toBeChecked();
  await expect(rowBcAfter.getByRole("checkbox")).toBeChecked();

  // Unchecking and re-checking an endpoint component keeps the connection
  // hidden: the flag survives the component leaving the view.
  const tree = page.getByTestId("modeling-pane-right");
  const visBPlacement = tree
    .locator("li", { hasText: "vis-b" })
    .first()
    .getByRole("checkbox")
    .first();
  await visBPlacement.uncheck();
  // With an endpoint unplaced, neither connection is listed.
  await expect(page.getByTestId("connection-row-link-ab")).toBeHidden();
  await expect(page.getByTestId("connection-row-link-bc")).toBeHidden();
  await visBPlacement.check();
  // Both are listed again; the hidden one stays unchecked.
  await expect(page.getByTestId("connection-row-link-ab")).toBeVisible();
  await expect(page.getByTestId("connection-row-link-bc")).toBeVisible();
  await expect(
    page.getByTestId("connection-row-link-ab").getByRole("checkbox"),
  ).not.toBeChecked();
  await expect(
    page.getByTestId("connection-row-link-bc").getByRole("checkbox"),
  ).toBeChecked();
  await expect(canvasAfter.getByTestId("diagram-edge")).toHaveCount(1);

  // Showing it again redraws the edge and clears the flag from the file.
  await page
    .getByTestId("connection-row-link-ab")
    .getByRole("checkbox")
    .check();
  await expect(canvasAfter.getByTestId("diagram-edge")).toHaveCount(2);
  await expect
    .poll(async () => viewFile(await storedFiles(page)), { timeout: 10_000 })
    .not.toMatch(/hidden\s*=\s*true/);
});
