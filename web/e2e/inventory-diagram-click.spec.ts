import { expect, type Locator, type Page, test } from "@playwright/test";
import { createFromExample } from "./helpers";

// Inventory's preview is a diagram of the open definition, so a node in it is
// something the user can point at. Clicking one focuses the inventory on that
// component, which is the same thing clicking its card does — and therefore the
// same URL change, and the same back/forward. (The card-click half of that is
// covered in view-url-paths.spec.ts; this is the diagram-click path into the
// same handler.)
//
// No example ships a per-component view: the preview reads `views/<label>.hcl`
// and every view in the examples is named after something else, so all of their
// previews are the "no diagram yet" empty state. The fixture is therefore built
// through the app — create the view from Inventory's own empty state, then give
// it nodes by editing that file on the Code page — rather than by reaching past
// the UI into the store.

const VIEW_FILE = "views/flight-controller.hcl";
// Node keys are the components' qualified paths, which is what `layoutToHcl`
// writes and what the layout reader matches on. Two nodes, because they are two
// different cases: `mcu` is an *instance* of a definition of its own (the click
// has to resolve the instance to the definition it was sourced from), and
// `flight-controller` is the definition this preview is already showing.
//
// Placed clear of each other on purpose: a child box drawn over its parent's
// takes the parent's clicks, and clicking the parent is one of the two cases.
const VIEW_HCL = `view "flight-controller" {
  system = "quadcopter"

  node "quadcopter/flight-controller" {
    x      = 40
    y      = 40
    width  = 200
    height = 110
  }

  node "quadcopter/flight-controller/mcu" {
    x      = 40
    y      = 220
    width  = 140
    height = 80
  }
}
`;

/** The Code page's editor: the element that takes keystrokes and the lines it
 * renders. Monaco keeps a hidden readonly IME textarea, so the input is found
 * by the aria label Monaco gives the real one. */
function editor(page: Page) {
  const host = page.locator(".monaco-editor");
  return {
    host,
    lines: host.locator(".view-lines"),
    input: host.locator('[aria-label="Editor content"]'),
  };
}

/**
 * Replaces the open file's contents, by pasting rather than typing.
 *
 * Both obvious alternatives mangle HCL in Monaco's own hands: `type` fires
 * auto-close on every brace and quote, and `keyboard.insertText` arrives as
 * input events that Monaco still runs through the same auto-indent, which
 * cascades a fresh indent per newline and leaves the auto-closed braces behind
 * (observed: three closing braces for two openings). A paste is one atomic
 * insertion, so Monaco lays it down as written.
 */
async function replaceEditorContent(page: Page, text: string): Promise<void> {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const { host, input } = editor(page);
  await expect(host).toBeVisible();
  await host.click();
  await expect(input).toBeFocused();
  await page.evaluate((value) => navigator.clipboard.writeText(value), text);
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+v");
}

/** A node in the preview, by the name it announces. */
function nodeLink(diagram: Locator, label: string): Locator {
  return diagram.getByRole("link", { name: `${label}, open in inventory` });
}

/** Creates `views/flight-controller.hcl` with `VIEW_HCL` in it, through the UI. */
async function projectWithAPreviewedView(page: Page): Promise<string> {
  const id = await createFromExample(
    page,
    /Quadcopter Drone/,
    "E2E inventory node click",
  );
  await page.goto(`/projects/${id}/inventory`);
  // `flight-controller` is a composite definition and has no view of its own,
  // which is the state every example's preview is in.
  await page.getByText("flight-controller").first().click();
  const emptyState = page.getByTestId("inventory-empty-diagram");
  await expect(emptyState).toBeVisible();
  await emptyState
    .getByRole("button", { name: "Create a view for this component" })
    .click();

  // The app writes that file and opens it in Modeling; give it the nodes by
  // editing what it wrote. The Code page saves each change back to the store.
  await expect(page).toHaveURL(
    `/projects/${id}/modeling/flight-controller.hcl`,
  );
  await page.goto(
    `/projects/${id}/code?file=${encodeURIComponent(VIEW_FILE)}`,
  );
  await replaceEditorContent(page, VIEW_HCL);
  // Asserted on the rendered lines, so a mangled edit fails on the edit rather
  // than later on a canvas that never got its nodes.
  await expect(editor(page).lines).toContainText(
    "quadcopter/flight-controller/mcu",
  );
  return id;
}

test("clicking a node in the preview focuses that component, and the URL follows", async ({ page }) => {
  const id = await projectWithAPreviewedView(page);
  await page.goto(`/projects/${id}/inventory/flight-controller`);
  const diagram = page.getByTestId("inventory-diagram");
  const node = nodeLink(diagram, "mcu");
  await expect(node).toBeVisible();

  // Clicking it focuses the inventory on the definition that instance was
  // sourced from — not on the label drawn on the canvas — and the address bar
  // says so.
  await node.click();
  await expect(page).toHaveURL(`/projects/${id}/inventory/mcu`);
  await expect(
    page.getByTestId("inventory-card").filter({
      hasText: "mcu",
    }),
  ).toHaveAttribute("aria-pressed", "true");

  // ...which is a navigation, so the browser's back button undoes it and the
  // forward button redoes it. The preview follows rather than going stale: the
  // diagram comes back on the way back, and `mcu` — which has no view of its
  // own — is the empty state on the way forward.
  await page.goBack();
  await expect(page).toHaveURL(`/projects/${id}/inventory/flight-controller`);
  await expect(page.getByTestId("inventory-empty-diagram")).toBeHidden();

  await page.goForward();
  await expect(page).toHaveURL(`/projects/${id}/inventory/mcu`);
  await expect(page.getByTestId("inventory-empty-diagram")).toBeVisible();
});

test("clicking the node already shown is not a navigation", async ({ page }) => {
  const id = await projectWithAPreviewedView(page);
  await page.goto(`/projects/${id}/inventory/flight-controller`);
  const diagram = page.getByTestId("inventory-diagram");

  // The preview draws the definition it is previewing, so one of its nodes is
  // the thing already focused. Focusing what is already focused must leave the
  // URL alone — a node that pushed a history entry anyway would strand the
  // user on a Back press that appears to do nothing.
  await nodeLink(diagram, "flight-controller").click();
  await expect(page).toHaveURL(`/projects/${id}/inventory/flight-controller`);
  await expect(nodeLink(diagram, "mcu")).toBeVisible();
});
