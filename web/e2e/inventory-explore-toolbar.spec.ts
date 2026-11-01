import { expect, test } from "@playwright/test";
import { createFromExample } from "./helpers";

// The modeling toolbar (toggle grid, zoom to fill, ...) is re-used on
// inventory/ and explore/ with only a subset of buttons: "Zoom to Fill"
// and "Toggle Grid". The remaining buttons must not show.
test("explore shows a minimal toolbar with only zoom-to-fill and toggle-grid", async ({
  page,
}) => {
  const id = await createFromExample(
    page,
    /Quadcopter Drone/,
    "E2E explore toolbar",
  );
  await page.goto(`/projects/${id}/explore`);

  const toolbar = page.getByTestId("diagram-toolbar");
  await expect(toolbar).toBeVisible();
  await expect(
    toolbar.getByRole("button", { name: "Zoom to Fill" }),
  ).toBeVisible();
  await expect(
    toolbar.getByRole("button", { name: "Toggle Grid" }),
  ).toBeVisible();

  await expect(
    toolbar.getByRole("button", { name: "Snap to Grid" }),
  ).toHaveCount(0);
  await expect(
    toolbar.getByRole("button", { name: "Auto Layout" }),
  ).toHaveCount(0);
  await expect(toolbar.getByRole("button", { name: "Reset View" })).toHaveCount(
    0,
  );
  await expect(
    toolbar.getByRole("button", { name: "+ Component" }),
  ).toHaveCount(0);
  await expect(toolbar.getByRole("button", { name: "+ Note" })).toHaveCount(0);
});

test("inventory shows a minimal toolbar with only zoom-to-fill and toggle-grid", async ({
  page,
}) => {
  const id = await createFromExample(
    page,
    /Quadcopter Drone/,
    "E2E inventory toolbar",
  );
  await page.goto(`/projects/${id}/inventory`);

  const diagram = page.getByTestId("inventory-diagram");
  await expect(diagram).toBeVisible();
  const toolbar = diagram.getByTestId("diagram-toolbar");
  await expect(toolbar).toBeVisible();
  await expect(
    toolbar.getByRole("button", { name: "Zoom to Fill" }),
  ).toBeVisible();
  await expect(
    toolbar.getByRole("button", { name: "Toggle Grid" }),
  ).toBeVisible();

  await expect(
    toolbar.getByRole("button", { name: "Snap to Grid" }),
  ).toHaveCount(0);
  await expect(
    toolbar.getByRole("button", { name: "Auto Layout" }),
  ).toHaveCount(0);
  await expect(toolbar.getByRole("button", { name: "Reset View" })).toHaveCount(
    0,
  );
});

test("explore toggle-grid hides and shows the background grid", async ({
  page,
}) => {
  const id = await createFromExample(
    page,
    /Quadcopter Drone/,
    "E2E explore grid toggle",
  );
  await page.goto(`/projects/${id}/explore`);

  const toolbar = page.getByTestId("diagram-toolbar");
  await expect(toolbar).toBeVisible();
  const grid = page.getByTestId("diagram-grid");
  await expect(grid).toBeVisible();
  await toolbar.getByRole("button", { name: "Toggle Grid" }).click();
  await expect(grid).toBeHidden();
  await toolbar.getByRole("button", { name: "Toggle Grid" }).click();
  await expect(grid).toBeVisible();
});
