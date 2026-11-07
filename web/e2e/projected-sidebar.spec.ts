import { expect, test } from "@playwright/test";
import { createNewProject, replaceModel } from "./helpers";

// The sidebar lists every in-system connection (placed or not). A connection
// whose endpoints are hidden but whose nearest visible ancestors are placed
// is badged `Projected` — and stays unchecked, because the canvas does not
// draw projected edges yet (0005.2). Placing the real owners clears the badge
// and checks the row as the edge draws.
const MODEL = `protocol "sig" {}
component "sense" {
  leaf = true
  port "out" {
    protocol = "sig"
  }
}
component "mod-a" {
  instance "sen-a" {
    source = "sense"
  }
}
component "mod-c" {
  instance "sen-c" {
    source = "sense"
  }
}
system "bench" {
  instance "A" {
    source = "mod-a"
  }
  instance "C" {
    source = "mod-c"
  }
  connection "low-link" {
    from = "A/sen-a/out"
    to   = "C/sen-c/out"
  }
}
`;

test("projected connections are listed with a badge until owners are placed", async ({
  page,
}) => {
  const id = await createNewProject(page, "E2E projected sidebar");
  await replaceModel(page, MODEL);
  await page.goto(`/projects/${id}/modeling`);
  await expect(page.getByTestId("diagram-toolbar")).toBeVisible();

  const tree = page.getByTestId("modeling-pane-right");
  const row = page.getByTestId("connection-row-low-link");
  const badge = page.getByTestId("projected-badge-low-link");

  async function place(name: string): Promise<void> {
    const button = tree.getByRole("button", { name, exact: true });
    await expect(button).toBeVisible();
    // The row div holds exactly this row's checkbox; the enclosing li would
    // also match nested descendants' boxes.
    const item = button.locator("xpath=parent::*");
    await item.getByRole("checkbox").check();
  }

  // Nothing placed: the connection is listed (new in 0005.1) but unchecked
  // and unbadged — no visible ancestor to project through.
  await expect(row).toBeVisible();
  await expect(row.getByRole("checkbox")).not.toBeChecked();
  await expect(badge).toHaveCount(0);
  await expect(
    page.getByTestId("diagram-canvas").getByTestId("diagram-edge"),
  ).toHaveCount(0);

  // Place the ancestors: the row is badged Projected and checked, and the
  // canvas draws the projected edge between A and C (0005.2).
  await place("A");
  await place("C");
  await expect(badge).toBeVisible();
  await expect(badge).toHaveText("Projected");
  await expect(row.getByRole("checkbox")).toBeChecked();
  await expect(
    page.getByTestId("diagram-canvas").getByTestId("diagram-edge"),
  ).toHaveCount(1);

  // Place the real owners: the badge clears and the edge stays drawn,
  // now anchored directly.
  await tree.getByRole("button", { name: "Expand all" }).click();
  await place("sen-a");
  await place("sen-c");
  await expect(badge).toHaveCount(0);
  await expect(row.getByRole("checkbox")).toBeChecked();
  await expect(
    page.getByTestId("diagram-canvas").getByTestId("diagram-edge"),
  ).toHaveCount(1);
});

// Parallel connections projecting onto the same visible pair each keep their
// identity and draw separately; a connection that would project to a
// self-edge is omitted; hiding still applies per name.
const PARALLEL_MODEL = `protocol "sig" {}
component "sense" {
  leaf = true
  port "out" {
    protocol = "sig"
  }
  port "aux" {
    protocol = "sig"
  }
}
component "mod-a" {
  instance "sen-a" {
    source = "sense"
  }
}
component "mod-c" {
  instance "sen-c" {
    source = "sense"
  }
}
system "bench" {
  instance "A" {
    source = "mod-a"
  }
  instance "C" {
    source = "mod-c"
  }
  connection "link-1" {
    from = "A/sen-a/out"
    to   = "C/sen-c/out"
  }
  connection "link-2" {
    from = "A/sen-a/aux"
    to   = "C/sen-c/aux"
  }
  connection "inner" {
    from = "A/sen-a/out"
    to   = "A/sen-a/aux"
  }
}
`;

test("parallel projected connections draw separately; projected self-edges omit", async ({
  page,
}) => {
  const id = await createNewProject(page, "E2E projected canvas");
  await replaceModel(page, PARALLEL_MODEL);
  await page.goto(`/projects/${id}/modeling`);
  await expect(page.getByTestId("diagram-toolbar")).toBeVisible();

  const tree = page.getByTestId("modeling-pane-right");
  const canvas = page.getByTestId("diagram-canvas");

  async function place(name: string): Promise<void> {
    const button = tree.getByRole("button", { name, exact: true });
    await expect(button).toBeVisible();
    const item = button.locator("xpath=parent::*");
    await item.getByRole("checkbox").check();
  }

  await place("A");
  await place("C");

  const row1 = page.getByTestId("connection-row-link-1");
  const row2 = page.getByTestId("connection-row-link-2");
  const rowInner = page.getByTestId("connection-row-inner");
  await expect(row1.getByRole("checkbox")).toBeChecked();
  await expect(row2.getByRole("checkbox")).toBeChecked();
  await expect(page.getByTestId("projected-badge-link-1")).toBeVisible();
  await expect(page.getByTestId("projected-badge-link-2")).toBeVisible();
  // inner would project A → A: omitted, so listed unchecked and unbadged.
  await expect(rowInner.getByRole("checkbox")).not.toBeChecked();
  await expect(page.getByTestId("projected-badge-inner")).toHaveCount(0);
  // Both parallels draw; the omitted self-edge does not.
  await expect(canvas.getByTestId("diagram-edge")).toHaveCount(2);

  // Hiding applies per name on projected edges too.
  await row1.getByRole("checkbox").uncheck();
  await expect(canvas.getByTestId("diagram-edge")).toHaveCount(1);
  await row1.getByRole("checkbox").check();
  await expect(canvas.getByTestId("diagram-edge")).toHaveCount(2);
});
