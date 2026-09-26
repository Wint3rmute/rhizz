import { expect, type Page, test } from "@playwright/test";

// A project lives at the slug of its name: "Drone System" is created at
// /projects/drone-system and nowhere else. Because the slug *is* the
// project's identity, a second name that slugs to the same address is
// refused — by the store (so no UI can create it) and surfaced in the UI.
test("a new project is addressed by the slug of its name", async ({ page }) => {
  await page.goto("/");
  const create = page.getByRole("button", { name: "New project" }).first();
  await expect(create).toBeVisible();
  page.on("dialog", (dialog) => void dialog.accept("Drone System"));
  await create.click();

  // The address is the slug: no id, no uuid.
  await expect(page).toHaveURL(/\/projects\/drone-system\/(code|overview)/);
  await expect(page.getByText("Drone System")).toBeVisible();
});

test("creating a second project with the same slug is refused", async ({ page }) => {
  await page.goto("/");
  // One handler for both creations, driven by this variable — two
  // `page.on("dialog")` registrations would fight over the same dialog.
  let name = "Drone System";
  page.on("dialog", (dialog) => void dialog.accept(name));

  await page.getByRole("button", { name: "New project" }).first().click();
  await expect(page).toHaveURL(/\/projects\/drone-system\//);
  await skipTour(page);

  // Same slug, different name — refused, with the contested address spelled
  // out so the user knows which name to change.
  name = "drone system!";
  await page.goto("/");
  await page.getByRole("button", { name: "New project" }).first().click();
  await expect(page.getByRole("alert")).toContainText("drone-system");

  // …and nothing was created: still the landing page, with one project.
  await expect(page).toHaveURL(/\/(projects)?$/);
  await expect(page.getByRole("button", { name: "Rename" })).toHaveCount(1);
  // The card still offers the original project (the toast quotes the refused
  // name too, so target the card's own button).
  await expect(
    page.getByRole("button", { name: /Drone System/ }),
  ).toBeVisible();
});

test("renaming a project re-addresses it", async ({ page }) => {
  // One handler for both dialogs (see the note above).
  let name = "Old Name";
  page.on("dialog", (dialog) => void dialog.accept(name));

  await page.goto("/");
  await page.getByRole("button", { name: "New project" }).first().click();
  await expect(page).toHaveURL(/\/projects\/old-name\//);
  await skipTour(page);

  await page.goto("/");
  name = "Drone System";
  await page.getByRole("button", { name: "Rename" }).click();
  await expect(
    page.getByRole("button", { name: /Drone System/ }),
  ).toBeVisible();

  // The address follows the name — opening the renamed project lands on the
  // new slug…
  await page.getByRole("button", { name: /Drone System/ }).click();
  await expect(page).toHaveURL(/\/projects\/drone-system\//);

  // …and the project's files moved with it rather than being orphaned under
  // the old address.
  await page.goto("/projects/drone-system/code");
  await expect(page.getByText("main.hcl").first()).toBeVisible();
});

async function skipTour(page: Page) {
  const tour = page.getByRole("alertdialog");
  if (await tour.isVisible()) {
    await tour.getByRole("button", { name: "skip tour" }).click();
    await expect(tour).toBeHidden();
  }
}
