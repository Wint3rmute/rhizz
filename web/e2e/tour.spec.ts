import { expect, type Page, test } from "@playwright/test";
import { expectInViewport } from "./helpers";

// Full walkthrough e2e: creating the first project auto-opens the guided
// tour, and Next walks all fourteen stops across the six workspace pages to
// Done. Desktop viewport only — the tour entry point is desktop-gated.
// Unit tests cover the step factory/targets/store; these specs prove the
// cross-page wiring — mount, per-step navigation, spotlight, advance.
//
// Two creations, one walk: from the drone example (every stop has content
// to spotlight) and from an empty project (its model has no `project`
// block, so the overview renders without a named header card — regression:
// the Overview anchor lived only on that card, so Zag never resolved the
// target and closed the whole tour as TARGET.NOT_FOUND around step 4).
async function createFirstProject(
  page: Page,
  source: "example" | "empty",
): Promise<void> {
  await page.goto("/");
  if (source === "example") {
    await page.getByRole("button", { name: "Learn by example" }).click();
    // The example card prompts for the project name — arm the handler
    // before clicking it (same pattern as smoke.spec.ts).
    page.on("dialog", (dialog) => void dialog.accept("E2E tour"));
    await page.getByRole("button", { name: /Quadcopter Drone/ }).click();
  } else {
    const create = page.getByRole("button", { name: "New project" }).first();
    await expect(create).toBeVisible();
    page.on("dialog", (dialog) => void dialog.accept("E2E empty tour"));
    await create.click();
  }
  // Creation lands in code; the armed first-run tour may already
  // have routed onward to the overview by the time the poll lands.
  await expect(page).toHaveURL(/\/projects\/.+\/(code|overview)/);
}

for (const source of ["example", "empty"] as const) {
  test(`first project (${source}) auto-opens the tour; Next walks all pages to Done`, async ({ page }) => {
    await createFirstProject(page, source);

    // First-run pending start: the welcome dialog opens on its own.
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Welcome to Rhizz 👋")).toBeVisible();
    await expectInViewport(dialog);

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
      // Visibility is not enough: the card must sit fully in the viewport,
      // not float half off-screen on any stop.
      await expectInViewport(dialog);
    }

    // Last stop offers Done; the tour closes and the page stays usable.
    await dialog.getByText("Done").click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("link", { name: "Modeling" }).first())
      .toBeVisible();
  });
}
