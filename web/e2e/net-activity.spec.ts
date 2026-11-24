import { expect, test } from "@playwright/test";
import { createNewProject } from "./helpers";

// The widget fades over ~500ms; keep real motion here so the fade (and the
// error state it carries) stays observable — the global e2e config forces
// `reducedMotion: reduce`, which skips the fade entirely.
test.use({ reducedMotion: "no-preference" });

test("idle shows no network activity", async ({ page }) => {
  const id = await createNewProject(page, "E2E net idle");
  await page.goto(`/projects/${id}/overview`);
  await expect(page.getByTestId("diagnostics-status-bar")).toBeVisible();
  await expect(page.getByTestId("net-activity")).toHaveCount(0);
});

test("slow upload shows Uploading with the loading bar", async ({ page }) => {
  const id = await createNewProject(page, "E2E net uploading");
  await page.goto(`/projects/${id}/overview`);
  await expect(page.getByTestId("diagnostics-status-bar")).toBeVisible();

  // Start a tracked PUT …/files that stays in flight: the widget appears
  // only after its 300ms threshold, so a fast op would never flicker.
  await page.evaluate(() => {
    const activity = (window as unknown as { __netActivity: unknown })
      .__netActivity as {
      track: (
        url: string,
        method: string,
        task: () => Promise<never>,
      ) => Promise<never>;
    };
    const pending = new Promise<never>(() => {});
    void activity.track(
      "http://test/api/projects/x/files",
      "PUT",
      () => pending,
    );
  });

  await expect(page.getByTestId("net-activity")).toContainText("Uploading…");
  await expect(
    page.locator('[data-testid="net-activity"] .loading-bars'),
  ).toBeVisible();
  await expect(page.getByTestId("net-activity")).toHaveAttribute(
    "role",
    "status",
  );

  // Resetting drops the still-pending request so the page closes cleanly.
  await page.evaluate(() => {
    const activity = (window as unknown as { __netActivity: unknown })
      .__netActivity as {
      reset: () => void;
    };
    activity.reset();
  });
  await expect(page.getByTestId("net-activity")).toHaveCount(0);
});

test("simulated outage shows the error state", async ({ page, context }) => {
  const id = await createNewProject(page, "E2E net outage");
  await page.goto(`/projects/${id}/overview`);
  await expect(page.getByTestId("diagnostics-status-bar")).toBeVisible();

  await context.setOffline(true);
  try {
    await page.evaluate(() => {
      const activity = (window as unknown as { __netActivity: unknown })
        .__netActivity as {
        track: (
          url: string,
          method: string,
          task: () => Promise<Response>,
        ) => Promise<Response>;
      };
      // A tracked sync that fails like a real offline fetch would.
      return activity
        .track("http://test/api/vfs", "GET", () =>
          Promise.reject(new TypeError("network down")),
        )
        .catch(() => undefined);
    });
    const pill = page.getByTestId("net-activity");
    await expect(pill).toContainText("Sync failed");
    await expect(pill).toHaveAttribute("data-error", "true");
  } finally {
    await context.setOffline(false);
  }

  // The error carries the same fade-out as a success.
  await expect(page.getByTestId("net-activity")).toHaveCount(0);
});
