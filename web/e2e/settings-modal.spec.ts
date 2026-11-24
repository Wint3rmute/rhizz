import { expect, test } from "@playwright/test";

// Global settings live only in localStorage (see TransitionState,
// ThemeState, WarningLevelState).
const THEME_KEY = "THEME";
const WARNING_KEY = "RHIZZ_WARNING_LEVEL";
const TRANSITION_KEY = "RHIZZ_TRANSITION_MS";

test("settings modal edits global settings and persists them", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open settings" }).click();
  const dialog = page.getByTestId("settings-modal");
  await expect(dialog).toBeVisible();

  const theme = page.locator("select#settings-theme");
  await expect(theme).toBeVisible();
  await theme.selectOption("dark");
  await expect
    .poll(
      async () =>
        await page.evaluate((k) => localStorage.getItem(k), THEME_KEY),
    )
    .toBe("dark");

  const level = page.locator("select#settings-warning-level");
  await level.selectOption("business");
  await expect
    .poll(
      async () =>
        await page.evaluate((k) => localStorage.getItem(k), WARNING_KEY),
    )
    .toBe('"business"');

  const transition = page.locator("input#settings-transition");
  await transition.fill("1200");
  await expect(page.getByTestId("settings-transition-value")).toContainText(
    "1200",
  );
  await expect
    .poll(
      async () =>
        await page.evaluate((k) => localStorage.getItem(k), TRANSITION_KEY),
    )
    .toBe("1200");

  await page.getByRole("button", { name: "Close settings" }).click();
  await expect(dialog).toBeHidden();

  await page.reload();
  await page.getByRole("button", { name: "Open settings" }).click();
  await expect(page.locator("select#settings-theme")).toHaveValue("dark");
  await expect(page.locator("select#settings-warning-level")).toHaveValue(
    "business",
  );
  await expect(page.locator("input#settings-transition")).toHaveValue("1200");
});

test("a corrupt stored transition falls back to the default", async ({
  page,
}) => {
  await page.addInitScript(
    (key) => void localStorage.setItem(key, "fast"),
    TRANSITION_KEY,
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Open settings" }).click();
  await expect(page.locator("input#settings-transition")).toHaveValue("320");
});
