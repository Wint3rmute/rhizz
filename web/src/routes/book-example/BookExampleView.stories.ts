import type { Meta, StoryObj } from "@storybook/svelte";
import { expect, userEvent, waitFor, within } from "storybook/test";
import BookExampleView from "./BookExampleView.svelte";
import { DEMO_FILES } from "./demo";
import type { BookPayloadFile } from "./payload";

const meta = {
  title: "Book/BookExampleView",
  component: BookExampleView,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof BookExampleView>;

export default meta;

type Story = StoryObj<typeof meta>;

// Highlighting splits code across spans, and Testing Library only matches
// direct text nodes — so code assertions poll the <pre> element instead.
async function findCodeWith(
  canvasElement: HTMLElement,
  snippet: string,
): Promise<void> {
  await waitFor(() => {
    if (!canvasElement.querySelector("pre")?.textContent.includes(snippet)) {
      throw new Error(`code containing ${snippet} not shown yet`);
    }
  });
}

// The fallback demo project: diagram tab with two placed nodes.
export const DiagramTab: Story = {
  args: {
    files: DEMO_FILES,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText("sensor");
    await canvas.findByText("hub");
  },
};

// Clicking a file tab shows its highlighted HCL.
export const CodeTab: Story = {
  args: {
    files: DEMO_FILES,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      await canvas.findByRole("tab", { name: "system.hcl" }),
    );
    await findCodeWith(canvasElement, 'protocol "temp-bus"');
    await expect(
      canvasElement.querySelector(".hcl-keyword"),
    ).not.toBeNull();
    await expect(canvasElement.querySelector(".hcl-string")).not.toBeNull();
  },
};

// A clean project shows only the completion stats at the bottom — no
// verdict bar, no outline.
export const CleanProject: Story = {
  args: {
    files: DEMO_FILES,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText("Components");
    await canvas.findByText(/100\.0%/);
    await expect(canvas.queryByText(/No errors/)).toBeNull();
    await expect(canvas.queryByText("Diagnostics")).toBeNull();
  },
};

// Dropping the hub description triggers W004, shown directly at the bottom
// with no click needed. (Alert text runs together across <br/> elements,
// so the assertion uses a regex.)
const warningFiles: BookPayloadFile[] = DEMO_FILES.map((file) =>
  file.path === "system.hcl"
    ? {
      path: file.path,
      content: file.content.replace(
        '  description = "Reading collector"\n',
        "",
      ),
    }
    : file
);

export const WarningsShownDirectly: Story = {
  args: {
    files: warningFiles,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText("Diagnostics");
    await canvas.findByText(/W004/);
  },
};

// ?open=system.hcl lands directly on the code tab.
export const OpenCodeFile: Story = {
  args: {
    files: DEMO_FILES,
    open: "system.hcl",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await findCodeWith(canvasElement, 'protocol "temp-bus"');
    await expect(canvas.queryByText("sensor")).toBeNull();
  },
};

// ?open=diagrams/main.hcl lands on that diagram (and not on the code).
export const OpenDiagram: Story = {
  args: {
    files: DEMO_FILES,
    open: "diagrams/main.hcl",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText("sensor");
    await expect(canvas.queryByText(/protocol "temp-bus"/)).toBeNull();
  },
};

// The code view offers copying through the clipboard icon, with a
// checkmark confirming success.
export const CopyCode: Story = {
  args: {
    files: DEMO_FILES,
    open: "system.hcl",
  },
  play: async ({ canvasElement }) => {
    let written: string | null = null;
    Object.defineProperty(window.navigator, "clipboard", {
      value: {
        writeText: (text: string): Promise<void> => {
          written = text;
          return Promise.resolve();
        },
      },
      configurable: true,
    });
    const canvas = within(canvasElement);
    await userEvent.click(
      await canvas.findByRole("button", { name: "Copy code" }),
    );
    await canvas.findByRole("button", { name: "Copied" });
    await expect(written).toContain('protocol "temp-bus"');
  },
};

// A lone file hides the top bar entirely: just code plus diagnostics,
// like a plain ```rhizz block.
const singleFile: BookPayloadFile[] = DEMO_FILES.filter((file) =>
  file.path === "system.hcl"
);

export const SingleFile: Story = {
  args: {
    files: singleFile,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await findCodeWith(canvasElement, 'protocol "temp-bus"');
    await expect(canvas.queryByRole("tablist")).toBeNull();
    await expect(canvas.queryByRole("tab")).toBeNull();
    await canvas.findByText("Components");
  },
};

// A bare filename also resolves (?open=main.hcl finds diagrams/main.hcl).
export const OpenBareFilename: Story = {
  args: {
    files: DEMO_FILES,
    open: "main.hcl",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText("sensor");
  },
};

// The toggle flips a diagram file to its source and back.
export const ToggleDiagramCode: Story = {
  args: {
    files: DEMO_FILES,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText("sensor");
    await userEvent.click(
      await canvas.findByRole("button", { name: "Show code" }),
    );
    await findCodeWith(canvasElement, 'view "main"');
    await expect(canvas.queryByText("sensor")).toBeNull();
    await userEvent.click(
      await canvas.findByRole("button", { name: "Show diagram" }),
    );
    await canvas.findByText("sensor");
  },
};

export const ToggleDisabledForSource: Story = {
  args: {
    files: DEMO_FILES,
    open: "system.hcl",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await findCodeWith(canvasElement, 'protocol "temp-bus"');
    const toggle = await canvas.findByRole("button", {
      name: "Diagram view unavailable",
    });
    await expect(toggle.getAttribute("disabled")).not.toBeNull();
  },
};

// The top-right theme switcher flips the applied theme and swaps its
// icon. Note: assertions stay on the button itself — the storybook runner
// forces its own data-theme on the document, so document-level assertions
// would measure the harness, not the component.
export const ThemeSwitcher: Story = {
  args: {
    files: DEMO_FILES,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const toggle = await canvas.findByRole("button", {
      name: /Switch to (light|dark) theme/,
    });
    const before = toggle.getAttribute("aria-label");
    await userEvent.click(toggle);
    const flipped = before === "Switch to dark theme"
      ? "Switch to light theme"
      : "Switch to dark theme";
    await canvas.findByRole("button", { name: flipped });
  },
};
