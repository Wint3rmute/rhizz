import { expect, test } from "@playwright/test";

// Full walkthrough e2e: creating the first project (here from the drone
// example, so every stop has content to spotlight) auto-opens the guided
// tour, and Next walks all nine stops across the six workspace pages to
// Done. Desktop viewport only — the tour entry point is desktop-gated.
// Unit tests cover the step factory/targets/store; this spec proves the
// cross-page wiring — mount, per-step navigation, spotlight, advance.
test("first project auto-opens the tour; Next walks all pages to Done", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start from an example" }).click();
  // The example card prompts for the project name — arm the handler
  // before clicking it (same pattern as smoke.spec.ts).
  page.on("dialog", (dialog) => void dialog.accept("E2E tour"));
  await page.getByRole("button", { name: /Quadcopter Drone/ }).click();
  await expect(page).toHaveURL(/\/projects\/.+\/editor/);

  // First-run pending start: the welcome dialog opens on its own.
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Welcome to Rhizz 👋")).toBeVisible();

  // Walk every stop; each step navigates to its page before spotlighting.
  const next = page.getByRole("button", { name: "next step" });
  const titles = [
    "Navbar",
    "System Overview",
    "Diagrams: the core tool",
    "Diagrams: selection & inspector",
    "Inventory",
    "Explore",
    "Editor",
    "You're set 🚀",
  ];
  for (const title of titles) {
    await next.click();
    await expect(dialog.getByText(title)).toBeVisible();
  }

  // Last stop offers Done; the tour closes and the page stays usable.
  await dialog.getByText("Done").click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("link", { name: "Diagrams" }).first())
    .toBeVisible();
});
