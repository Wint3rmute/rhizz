import type { Meta, StoryObj } from "@storybook/svelte";
import { expect, userEvent, within } from "storybook/test";
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

// Switching to the Code tab shows the raw HCL with a file selector.
export const CodeTab: Story = {
  args: {
    files: DEMO_FILES,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("tab", { name: "Code" }));
    await canvas.findByText(/protocol "temp-bus"/);
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
    await canvas.findByText(/protocol "temp-bus"/);
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
