import { expect, test, type Locator, type Page } from "@playwright/test";
import { createFromExample } from "./helpers";

// A diagnostic row names where it points (`system.hcl:461`); the label links
// to the Code page, which opens that file with the cursor on that line.

/** The location links (`file:line`) in the open diagnostics panel. */
function locationLinks(page: Page): Locator {
  return page
    .getByTestId("diagnostics-panel")
    .getByRole("link", { name: /^\S+\.hcl:\d+$/ });
}

/** The file and line in a `file:line` label. */
async function locationOf(
  link: Locator,
): Promise<{ file: string; line: string }> {
  const label = (await link.textContent())?.trim() ?? "";
  const match = /^(.+):(\d+)$/.exec(label);
  if (!match?.[1] || !match[2]) throw new Error(`no file:line in ${label}`);
  return { file: match[1], line: match[2] };
}

test("a diagnostic's file:line opens the Code page at that line", async ({
  page,
}) => {
  const id = await createFromExample(
    page,
    /Quadcopter Drone/,
    "E2E diagnostic location",
  );
  await page.goto(`/projects/${id}/modeling`);
  await page
    .getByTestId("diagnostics-status-bar")
    .getByRole("button", { name: "Expand diagnostics" })
    .click();

  // The last location is far down the file, so the editor has to scroll.
  const link = locationLinks(page).last();
  const { file, line } = await locationOf(link);
  await link.click();

  await expect(page).toHaveURL(
    new RegExp(`/projects/${id}/code\\?file=${encodeURIComponent(file)}`),
  );
  const editor = page.locator(".monaco-editor").first();
  await expect(editor.locator(".active-line-number")).toHaveText(line);
  // The line param is consumed, so the same link can jump again.
  await expect(page).not.toHaveURL(/line=/);

  // Move the cursor away, then follow the same link from the Code page (the
  // panel stays open across the navigation).
  await editor.locator(".view-lines").click();
  await page.keyboard.press("Control+Home");
  await expect(editor.locator(".active-line-number")).toHaveText("1");
  await locationLinks(page).last().click();
  await expect(editor.locator(".active-line-number")).toHaveText(line);
});
