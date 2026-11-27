import { expect, test } from "@playwright/test";
import { createNewProject, replaceModel } from "./helpers";

// Unconnected ports can be shown per view from the Components tree, e.g. to
// outline a component's public interface without naming its consumers.
const MODEL = `component "alpha" {
  leaf = true
  port "api" {
    protocol = "p"
    role     = "provider"
  }
  port "debug" {
    protocol = "p"
  }
  port "bus" {
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
    from = "alpha/bus"
    to   = "beta/sink"
  }
}
`;

test("shows an unconnected port in the view from the Components tree", async ({
  page,
}) => {
  const id = await createNewProject(page, "E2E port visibility");
  await replaceModel(page, MODEL);
  await page.goto(`/projects/${id}/modeling`);
  await expect(page.getByTestId("diagram-toolbar")).toBeVisible();

  const tree = page.getByTestId("modeling-pane-right");
  const canvas = page.getByTestId("diagram-canvas");
  for (const name of ["alpha", "beta"]) {
    await tree
      .locator("li", { hasText: name })
      .first()
      .getByRole("checkbox")
      .check();
  }
  // Only the connected port is drawn by default.
  await expect(canvas.getByText("bus", { exact: true })).toBeVisible();
  await expect(canvas.getByText("api", { exact: true })).toHaveCount(0);

  // Ports are listed under their component with an eye toggle.
  const api = tree.getByRole("button", { name: "Show port api" });
  const bus = tree.getByRole("button", { name: "Show port bus" });
  await expect(api).toHaveAttribute("aria-pressed", "false");
  // A port a drawn connection uses is always shown: locked on.
  await expect(bus).toHaveAttribute("aria-pressed", "true");
  await expect(bus).toBeDisabled();

  await api.click();
  await expect(canvas.getByText("api", { exact: true })).toBeVisible();
  await expect(canvas.getByText("debug", { exact: true })).toHaveCount(0);

  // Persisted in the view file: survives a reload.
  await expect
    .poll(async () => {
      await page.reload();
      await expect(page.getByTestId("diagram-toolbar")).toBeVisible();
      return canvas.getByText("api", { exact: true }).count();
    })
    .toBe(1);

  await tree.getByRole("button", { name: "Show port api" }).click();
  await expect(canvas.getByText("api", { exact: true })).toHaveCount(0);
});

test("a port added in the Inspector is shown in the open view", async ({
  page,
}) => {
  const id = await createNewProject(page, "E2E port visibility add");
  await replaceModel(page, MODEL);
  await page.goto(`/projects/${id}/modeling`);
  await expect(page.getByTestId("diagram-toolbar")).toBeVisible();

  const tree = page.getByTestId("modeling-pane-right");
  const canvas = page.getByTestId("diagram-canvas");
  await tree
    .locator("li", { hasText: "alpha" })
    .first()
    .getByRole("checkbox")
    .check();
  await tree.getByRole("button", { name: "alpha", exact: true }).click();

  page.once("dialog", (dialog) => void dialog.accept("extra"));
  await page.getByRole("button", { name: "+ Add Port" }).click();
  await expect(canvas.getByText("extra", { exact: true })).toBeVisible();
});
