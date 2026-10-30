import { expect, test } from "@playwright/test";
import { createNewProject, replaceModel } from "./helpers";

// Ports whose connections are not drawn in the view stay hidden: only ports
// named by a drawn edge (or on a selected node, or during a connect drag)
// render labels. Repro: the homelab main view showed `lan`/`wifi` on `me`
// while neither lan-access nor wifi was drawn.
const MODEL = `component "alpha" {
  leaf = true
  port "used" {
    protocol = "p"
  }
  port "idle" {
    protocol = "p"
  }
}

component "beta" {
  leaf = true
  port "sink" {
    protocol = "p"
  }
}

system "demo" {
  instance "alpha" { source = "alpha" }
  instance "beta" { source = "beta" }

  connection "wire" {
    from = "alpha/used"
    to   = "beta/sink"
  }
}
`;

test("port labels hide when their connection is not drawn", async ({
  page,
}) => {
  const id = await createNewProject(page, "E2E port label visibility");
  await replaceModel(page, MODEL);
  await page.goto(`/projects/${id}/modeling`);
  await expect(page.getByTestId("diagram-toolbar")).toBeVisible();

  // Place both instances; select nothing.
  const tree = page.getByTestId("modeling-pane-right");
  for (const name of ["alpha", "beta"]) {
    await tree
      .locator("li", { hasText: name })
      .first()
      .getByRole("checkbox")
      .check();
  }
  const canvas = page.getByTestId("diagram-canvas");
  await expect(canvas.getByText("used", { exact: true })).toBeVisible();
  await expect(canvas.getByText("sink", { exact: true })).toBeVisible();
  await expect(canvas.getByText("idle", { exact: true })).toHaveCount(0);
});
