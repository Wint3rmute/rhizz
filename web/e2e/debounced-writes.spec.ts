import { expect, type Page, test } from "@playwright/test";
import { createNewProject } from "./helpers";

// Every VFS mutation persists the whole blob, so the two high-frequency write
// sources (the code editor's keystrokes, the canvas's drag ticks) are
// trailing-debounced: a burst must collapse into a *single* persisted write,
// and switching away mid-burst must not swallow the tail of it.
//
// Writes are counted by recording every blob the app persists, before it
// boots, and reading the file's content out of each one — a rewrite of
// identical content isn't a write, so the count is of real changes to that
// one file rather than of churn elsewhere in the blob.
const VIEW = "views/main.hcl";
const MAIN = "main.hcl";

async function instrumentVfsWrites(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    const writes: string[] = [];
    Storage.prototype.setItem = function (key: string, value: string): void {
      if (key.startsWith("rhizz:vfs")) writes.push(value);
      original.call(this, key, value);
    };
    (globalThis as unknown as { __vfsWrites?: string[] }).__vfsWrites = writes;
  });
}

// Every distinct content `path` was persisted with, in write order.
async function persistedVersions(page: Page, path: string): Promise<string[]> {
  return page.evaluate((filePath) => {
    type Node = {
      kind: "file" | "directory";
      name: string;
      parentId: string | null;
      content?: string;
    };
    const segments = filePath.split("/");
    const readFile = (blob: string): string | null => {
      const nodes = (JSON.parse(blob) as { nodes: Node[] }).nodes;
      const directories = new Map(
        nodes.filter((n) => n.kind === "directory").map((n) => [n.id, n.name]),
      );
      const file = nodes.find((n) =>
        n.kind === "file" && n.name === segments[segments.length - 1] &&
        (segments.length === 1
          ? n.parentId === null
          : directories.get(n.parentId ?? "") === segments[segments.length - 2])
      );
      return file?.content ?? null;
    };
    const blobs =
      (globalThis as unknown as { __vfsWrites?: string[] }).__vfsWrites ?? [];
    const versions: string[] = [];
    let previous: string | null = null;
    for (const blob of blobs) {
      const content = readFile(blob);
      if (content === null || content === previous) continue;
      previous = content;
      versions.push(content);
    }
    return versions;
  }, path);
}

async function lastPersisted(page: Page, path: string): Promise<string> {
  return (await persistedVersions(page, path)).at(-1) ?? "";
}

function xOf(layout: string): number {
  // The serializer aligns the `=` signs, hence the loose spacing.
  const match = /^\s*x\s*=\s*(-?\d+)/m.exec(layout);
  if (match?.[1] === undefined) {
    throw new Error(`no node position in layout:\n${layout}`);
  }
  return Number(match[1]);
}

async function openDiagram(page: Page, name: string): Promise<string> {
  const id = await createNewProject(page, name);
  await page.goto(`/projects/${id}/modeling`);
  await expect(page.getByTestId("diagram-canvas")).toBeVisible();
  return id;
}

async function createComponent(page: Page, label: string): Promise<void> {
  await page.getByRole("button", { name: "+ Component" }).click();
  const modal = page.getByTestId("create-component-modal");
  await expect(modal).toBeVisible();
  await modal.locator("#new-comp-name").fill(label);
  await modal.getByRole("button", { name: "Create Definition" }).click();
  await expect(modal).toBeHidden();
  await expect(
    page.getByTestId("diagram-canvas").getByText(label).first(),
  ).toBeVisible();
}

test("a burst of canvas nudges persists as a single layout write", async ({ page }) => {
  await instrumentVfsWrites(page);
  await openDiagram(page, "E2E debounce canvas");
  await createComponent(page, "e2e-debounce");

  const canvas = page.getByTestId("diagram-canvas");
  const label = canvas.getByText("e2e-debounce").first();
  const box = await label.boundingBox();
  if (!box) throw new Error("created node has no bounding box");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByTestId("node-inspector")).toBeVisible();

  // Creating the node scheduled a layout write of its own; wait for it, so
  // the burst below is the only thing the measurement covers.
  await expect.poll(() => lastPersisted(page, VIEW)).toContain("e2e-debounce");
  const before = await persistedVersions(page, VIEW);

  const startX = xOf(before[before.length - 1] ?? "");
  for (let press = 0; press < 5; press++) {
    await page.keyboard.press("ArrowRight");
  }

  // The persisted layout catches up with the canvas — through a single write,
  // carrying the final position rather than an intermediate one.
  await expect.poll(async () => xOf(await lastPersisted(page, VIEW))).toBe(
    startX + 50,
  );
  expect((await persistedVersions(page, VIEW)).length - before.length).toBe(1);
});

test("a burst of typing persists as a single file write", async ({ page }) => {
  await instrumentVfsWrites(page);
  const id = await createNewProject(page, "E2E debounce typing");
  await page.goto(`/projects/${id}/code`);
  await expect(page.locator(".monaco-editor")).toBeVisible();

  const before = await persistedVersions(page, MAIN);

  await page.locator(".monaco-editor").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\n# burst", { delay: 0 });

  await expect.poll(() => lastPersisted(page, MAIN)).toContain("# burst");
  expect((await persistedVersions(page, MAIN)).length - before.length).toBe(1);
});

test("switching files mid-burst persists the edit instead of losing it", async ({ page }) => {
  await instrumentVfsWrites(page);
  const id = await createNewProject(page, "E2E debounce switch");
  await page.goto(`/projects/${id}/code`);
  await expect(page.locator(".monaco-editor")).toBeVisible();

  // A second file, so switching away is a real switch.
  page.once("dialog", (dialog) => void dialog.accept("second.hcl"));
  await page.getByRole("button", { name: "+ File" }).click();
  await expect(page.getByRole("button", { name: "second.hcl" })).toBeVisible();

  await page.getByRole("button", { name: MAIN }).click();
  await page.locator(".monaco-editor").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\n# tail", { delay: 0 });

  // Straight back out to the other file, well inside the debounce window.
  await page.getByRole("button", { name: "second.hcl" }).click();
  await expect(page.locator(".monaco-editor")).toBeVisible();
  await page.getByRole("button", { name: MAIN }).click();

  // Coming back has to show the edit: the write landed on the way out, so the
  // reload of main.hcl finds it. Left pending until the timer fires, the read
  // would find the file as it was before the burst — and the editor would
  // show that instead.
  await expect(page.locator(".monaco-editor")).toContainText("# tail");
  await expect.poll(() => lastPersisted(page, MAIN)).toContain("# tail");
});

test("a reload right after typing keeps the edit", async ({ page }) => {
  await instrumentVfsWrites(page);
  const id = await createNewProject(page, "E2E debounce reload");
  await page.goto(`/projects/${id}/code`);
  await expect(page.locator(".monaco-editor")).toBeVisible();

  await page.locator(".monaco-editor").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\n# reloaded", { delay: 0 });

  // Reload inside the debounce window, before the timer could ever fire: the
  // tail is flushed on the way out of the document, because nothing else is
  // left to run it — a fresh document starts with an empty timer and an empty
  // editor.
  await page.reload();
  await expect(page.locator(".monaco-editor")).toBeVisible();
  await expect(page.locator(".monaco-editor")).toContainText("# reloaded");
});
