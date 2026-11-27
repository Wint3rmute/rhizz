import { expect, type Page, test } from "@playwright/test";
import { createNewProject } from "./helpers";

// `/` is always the landing page and `/projects` is always the projects list:
// what an address shows no longer depends on whether projects exist. The
// landing offers four ways in (a 2x2 grid on desktop), one of which leads to the
// list.

const HERO = /Model your system architecture and verify it\./;

function projectsCard(page: Page) {
  return page.getByRole("link", { name: /Your projects/ });
}

test("landing offers four ways in, including the projects list", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText(HERO)).toBeVisible();

  const newProject = page.getByRole("button", { name: /New project/ });
  const projects = projectsCard(page);
  const example = page.getByRole("button", { name: /Learn by example/ });
  const book = page.getByRole("link", { name: /Read the book/ });

  for (const card of [newProject, projects, example, book]) {
    await expect(card).toBeVisible();
  }
  // Nothing created yet: the card says so instead of disappearing.
  await expect(projects).toContainText("No projects yet");

  // A 2x2 grid: New project | Your projects, then example | book.
  const [a, b, c, d] = await Promise.all(
    [newProject, projects, example, book].map((l) => l.boundingBox()),
  );
  if (!a || !b || !c || !d) throw new Error("landing cards not laid out");
  expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(c.y - d.y)).toBeLessThanOrEqual(1);
  expect(b.x).toBeGreaterThan(a.x + a.width - 1);
  expect(c.y).toBeGreaterThan(a.y + a.height - 1);
  expect(Math.abs(a.x - c.x)).toBeLessThanOrEqual(1);
  // Same-size cards: New project stands out by colour, not by spanning the
  // row.
  expect(Math.abs(a.width - b.width)).toBeLessThanOrEqual(1);
});

test("projects list has its own empty state", async ({ page }) => {
  await page.goto("/");
  await projectsCard(page).click();
  await expect(page).toHaveURL(/\/projects$/);

  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  await expect(page.getByText("No projects yet")).toBeVisible();
  // The landing hero stays on the landing page.
  await expect(page.getByText(HERO)).toHaveCount(0);

  // The empty state starts a project right there.
  page.on("dialog", (dialog) => void dialog.accept("From the list"));
  await page
    .getByTestId("projects-empty")
    .getByRole("button", { name: "New project" })
    .click();
  await expect(page).toHaveURL(/\/projects\/from-the-list\//);
});

test("landing stays the landing page once projects exist", async ({ page }) => {
  await createNewProject(page, "Kept around");

  await page.goto("/");
  await expect(page.getByText(HERO)).toBeVisible();
  await expect(projectsCard(page)).toContainText("1 project");

  await projectsCard(page).click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByRole("button", { name: /Kept around/ })).toBeVisible();
});

test("navbar logo leads to the projects list", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Rhizome", exact: true }).click();
  await expect(page).toHaveURL(/\/projects$/);
});
