import { expect, type Locator, type Page } from "@playwright/test";

export async function skipTourIfPresent(page: Page): Promise<void> {
  const tourDialog = page.getByRole("alertdialog");
  if (await tourDialog.isVisible()) {
    await tourDialog.getByRole("button", { name: "Skip" }).click();
    await expect(tourDialog).toBeHidden();
  }
}

function projectIdFromUrl(page: Page): string {
  const id = new URL(page.url()).pathname.split("/")[2];
  if (!id) throw new Error("project id missing from URL");
  return id;
}

export async function createNewProject(
  page: Page,
  projectName: string,
): Promise<string> {
  await page.goto("/");
  const create = page.getByRole("button", { name: "New project" }).first();
  await expect(create).toBeVisible();
  page.once("dialog", (dialog) => void dialog.accept(projectName));
  await create.click();
  await expect(page).toHaveURL(/\/projects\/.+\/(code|overview)/);
  await skipTourIfPresent(page);
  return projectIdFromUrl(page);
}

export async function createFromExample(
  page: Page,
  exampleName: RegExp | string,
  projectName: string,
): Promise<string> {
  await page.goto("/");
  await page.getByRole("button", { name: "Learn by example" }).click();
  page.once("dialog", (dialog) => void dialog.accept(projectName));
  await page.getByRole("button", { name: exampleName }).click();
  await expect(page).toHaveURL(/\/projects\/.+\/(code|overview)/);
  await skipTourIfPresent(page);
  return projectIdFromUrl(page);
}

// The whole tour card must sit inside the viewport on every stop —
// `toBeVisible` alone passes for a card floating half off-screen. Asserts
// full containment (not just intersection) against the live viewport size,
// with a 1px rounding tolerance for sub-pixel placement math.
//
// Polls rather than sampling once: the tour positions its card after the
// target mounts, so a box read right after the heading appears can still be
// the pre-placement position (y = -720 on the first stop). A card that stays
// off-screen still fails once the poll times out.
export async function expectInViewport(target: Locator): Promise<void> {
  const viewport = target.page().viewportSize();
  if (!viewport) throw new Error("page has no viewport size");
  await expect
    .poll(async () => {
      const box = await target.boundingBox();
      if (!box) return null;
      return {
        left: box.x >= -1,
        top: box.y >= -1,
        right: box.x + box.width <= viewport.width + 1,
        bottom: box.y + box.height <= viewport.height + 1,
      };
    })
    .toEqual({ left: true, top: true, right: true, bottom: true });
}

const VFS_KEY = "rhizz:vfs:v1";

/** Every file in the VFS, keyed by its project-relative path. */
export async function storedFiles(page: import("@playwright/test").Page) {
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

export function viewFile(files: Record<string, string>): string {
  const entry = Object.entries(files).find(([path]) =>
    path.startsWith("views/"),
  );
  if (!entry) throw new Error(`no views file, have: ${Object.keys(files)}`);
  return entry[1]!;
}

/** Replaces the content of the project's top-level model file before the page loads. */
export async function replaceModel(page: Page, content: string): Promise<void> {
  await page.evaluate(
    ({ key, content }) => {
      const raw = window.localStorage.getItem(key);
      if (raw === null) throw new Error("no VFS in localStorage");
      const blob = JSON.parse(raw) as {
        nodes: {
          parentId: string | null;
          name: string;
          kind: string;
          content?: string;
        }[];
      };
      const file = blob.nodes.find(
        (n) =>
          n.kind === "file" &&
          n.parentId === null &&
          (n.name === "main.hcl" || n.name === "system.hcl"),
      );
      if (!file) throw new Error("no top-level model file");
      file.content = content;
      window.localStorage.setItem(key, JSON.stringify(blob));
    },
    { key: VFS_KEY, content },
  );
}

/**
 * Answers the "New connection" dialog that opens after a connection is drawn:
 * names the connection and creates it with the prefilled ports. Returns once
 * the dialog is gone.
 */
export async function confirmNewConnection(
  page: Page,
  name: string,
): Promise<void> {
  const dialog = page.getByTestId("new-connection-modal");
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("new-connection-name").fill(name);
  await dialog.getByTestId("new-connection-create").click();
  await expect(dialog).toBeHidden();
}
