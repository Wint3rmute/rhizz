import { expect, test } from "@playwright/test";

// Empty first project: its model has no `project` block, so the overview
// page renders without a named header card. The tour's Overview stop must
// still activate — regression: its anchor lived only on that card, so Zag
// never resolved the target and closed the whole tour as TARGET.NOT_FOUND
// around step 4. Walks all fourteen stops like tour.spec.ts does for the
// drone example.
test("empty first project walks the whole tour to Done", async ({ page }) => {
  await page.goto("/");
  const create = page.getByRole("button", { name: "New project" }).first();
  await expect(create).toBeVisible();
  page.on("dialog", (dialog) => void dialog.accept("E2E empty tour"));
  await create.click();
  // Creation lands in code; the armed first-run tour may already
  // have routed onward to the overview by the time the poll lands.
  await expect(page).toHaveURL(/\/projects\/.+\/(code|overview)/);

  // First-run pending start: the welcome dialog opens on its own.
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Welcome to Rhizz 👋")).toBeVisible();

  // Walk every stop; each step navigates to its page before spotlighting.
  const next = page.getByRole("button", { name: "next step" });
  const titles = [
    "Navbar",
    "Up next: Overview",
    "Overview",
    "Up next: Modeling",
    "Modeling: the core tool",
    "Modeling: selection & inspector",
    "Up next: Inventory",
    "Inventory",
    "Up next: Explore",
    "Explore",
    "Up next: Code",
    "Code",
    "You're set 🚀",
  ];
  for (const title of titles) {
    await next.click();
    // Titles render as the card heading; getByText would also match
    // description prose (e.g. "Code" appears in its own description).
    await expect(dialog.getByRole("heading", { name: title })).toBeVisible();
  }

  // Last stop offers Done; the tour closes and the page stays usable.
  await dialog.getByText("Done").click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("link", { name: "Modeling" }).first())
    .toBeVisible();
});
