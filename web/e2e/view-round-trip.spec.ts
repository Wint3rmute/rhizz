import { expect, test } from "@playwright/test";
import { createFromExample, skipTourIfPresent } from "./helpers";

// Regression guard for data loss caused by merely *opening* a view.
//
// Modeling reads a view file into a canvas-shaped layout and writes that
// layout straight back (debounced, on load as well as on edit). Anything the
// canvas does not model was therefore deleted on a plain visit: `full_name`,
// `tags` and the selection `filter` were dropped, because the writer
// re-emitted `full_name = ""`, `tags = []` and an empty filter.
//
// This runs against localStorage (the default e2e backend) on purpose — the
// loss is in the layout projection, not in any backend, so the guard needs no
// server. What a server-backed run adds is only visibility: there the change
// lands in real, git-tracked files.
const VFS_KEY = "rhizz:vfs:v1";

/** Every file in the VFS, keyed by its project-relative path. */
async function storedFiles(page: import("@playwright/test").Page) {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    if (raw === null) throw new Error("no VFS in localStorage");
    const blob = JSON.parse(raw) as {
      nodes: {
        id: string;
        projectId: string;
        parentId: string | null;
        name: string;
        kind: string;
        content?: string;
      }[];
    };
    // The flat node graph has no paths, so rebuild each one from its parent
    // chain — the same resolution `vfs/fs.ts` does.
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
      files[`${node.projectId}/${pathOf(node)}`] = node.content ?? "";
    }
    return files;
  }, VFS_KEY);
}

/**
 * What a view file *means*, ignoring how it is formatted.
 *
 * `serialize_views` re-emits canonical HCL — aligned `=`, fixed field order —
 * so a hand-written view is rewritten on a visit even when nothing was lost.
 * Comparing bytes would assert an unrelated formatter property; comparing
 * these facts asserts the one that matters: that opening a view cannot delete
 * any of it.
 */
function viewFacts(hcl: string) {
  const filterStart = hcl.indexOf("filter {");
  const filterEnd = filterStart === -1 ? -1 : hcl.indexOf("}", filterStart);
  const filterBody = filterStart === -1
    ? undefined
    : hcl.slice(filterStart, filterEnd);
  return {
    system: /system\s*=\s*"([^"]*)"/.exec(hcl)?.[1],
    fullName: /full_name\s*=\s*"([^"]*)"/.exec(hcl)?.[1],
    tags: /tags\s*=\s*(\[[^\]]*\])/.exec(hcl)?.[1]?.replace(/\s+/g, " "),
    // Sorted and whitespace-collapsed: the filter's *content*, not its layout.
    filter: filterBody
      ?.split("\n")
      .map((line) => line.trim().replace(/\s+/g, " "))
      .filter((line) => line !== "")
      .sort()
      .join("|"),
    nodes: [...hcl.matchAll(/node\s+"([^"]+)"/g)].map((m) => m[1]).sort(),
    annotations: [...hcl.matchAll(/annotation\s*\{/g)].length,
  };
}

test("browsing views does not rewrite them", async ({ page }) => {
  // The drone example is the useful fixture here: three of its four views
  // carry a `filter`, and one carries an `annotation` with a `scale`.
  const project = await createFromExample(
    page,
    /Quadcopter Drone/,
    "E2E view round trip",
  );

  await page.goto(`/projects/${project}/modeling`);
  await skipTourIfPresent(page);

  const before = await storedFiles(page);
  const viewFiles = Object.keys(before)
    .filter((path) => path.includes("/views/"))
    .sort();
  expect(viewFiles.length).toBeGreaterThan(1);
  const facts = new Map(viewFiles.map((p) => [p, viewFacts(before[p])]));
  expect(
    [...facts.values()].some((f) => f.filter !== undefined),
    "fixture should include a filtered view",
  ).toBe(true);
  expect(
    [...facts.values()].some((f) => f.fullName !== undefined),
    "fixture should include a named view",
  ).toBe(true);

  // Click through every view in the tree without touching the canvas.
  for (const path of viewFiles) {
    await page
      .locator("button", { hasText: path.split("/").pop() as string })
      .first()
      .click();
    await expect(page).toHaveURL(new RegExp(`${path.split("/").pop()}$`));
  }
  // Long enough for the 500ms layout debounce plus its write.
  await page.waitForTimeout(1500);

  const after = await storedFiles(page);
  for (const path of viewFiles) {
    expect(
      viewFacts(after[path]),
      `${path} lost something by being opened`,
    ).toEqual(facts.get(path));
  }
});

test("an edit still persists, and keeps the view's own attributes", async ({ page }) => {
  const project = await createFromExample(
    page,
    /Quadcopter Drone/,
    "E2E view round trip",
  );
  await page.goto(`/projects/${project}/modeling`);
  await skipTourIfPresent(page);

  // Open a filtered view, so an edit has attributes it does not own to lose.
  await page
    .locator("button", { hasText: "fc-internals.hcl" })
    .first()
    .click();
  await expect(page).toHaveURL(/fc-internals\.hcl$/);
  await page.waitForTimeout(1000);

  const before = await storedFiles(page);
  const path = `${project}/views/fc-internals.hcl`;
  expect(before[path]).toContain("filter {");

  // Place a component: the smallest edit that must reach disk.
  const checkbox = page.getByRole("checkbox").first();
  await expect(checkbox).toBeVisible();
  const wasChecked = await checkbox.isChecked();
  await checkbox.click();
  await page.waitForTimeout(1500);

  const after = await storedFiles(page);
  expect(after[path]).not.toBe(before[path]);
  // The parts the canvas does not model must have survived the rewrite.
  expect(after[path]).toContain("filter {");
  expect(after[path]).toContain("max_level");
  if (wasChecked) expect(after[path]).not.toContain("node ");
});
