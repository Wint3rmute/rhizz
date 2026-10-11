import { expect, test } from "@playwright/test";

// The book embeds `/book-example` in a cross-site iframe (mdBook site
// framing the app host). With third-party storage blocked — Safari by
// default, Chrome/Firefox/Brave under strict tracking protection — every
// `localStorage` touch throws a SecurityError, including evaluating the
// binding itself. That used to crash module init (ProjectState,
// ThemeState, WarningLevelState) and left the iframe rendering only its
// empty app background, while the same URL worked fine standalone.
test("book embed renders with third-party storage blocked", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("Access is denied", "SecurityError");
      },
      configurable: true,
    });
  });
  await page.goto("/book-example?example=drone");
  await expect(page.getByText("flight-controller").first()).toBeVisible();
  await expect(page.getByRole("tablist")).toBeVisible();
});
