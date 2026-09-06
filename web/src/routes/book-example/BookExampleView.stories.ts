import type { Meta, StoryObj } from "@storybook/svelte";
import { expect, userEvent, waitFor, within } from "storybook/test";
import BookExampleView from "./BookExampleView.svelte";
import type { BookPayloadFile } from "./payload";

// Sample project for stories: tiny but complete (protocol + definitions +
// instances + connection + placed diagram + annotation) so every surface
// has something to render.
const SAMPLE_FILES: BookPayloadFile[] = [
  {
    path: "system.hcl",
    content: `project {
  name = "book-demo"
}

protocol "temp-bus" {
  description = "Temperature sensor bus"
  roles       = ["provider", "consumer"]

  message "reading" {
    description = "A single temperature reading"

    field "celsius" {
      type        = "f32"
      description = "Temperature in Celsius"
    }
  }
}

component "sensor" {
  description = "Temperature sensor"
  leaf        = true

  port "out" {
    description = "Reading output"
    protocol    = "temp-bus"
    role        = "provider"
  }
}

component "hub" {
  description = "Reading collector"
  leaf        = true

  port "in" {
    description = "Reading input"
    protocol    = "temp-bus"
    role        = "consumer"
  }
}

system "demo" {
  description = "Minimal book example"

  instance "sensor" { source = "sensor" }
  instance "hub" { source = "hub" }

  connection "reading" {
    description = "Delivers readings to the hub"
    from        = "sensor/out"
    to          = "hub/in"
  }
}
`,
  },
  {
    path: "diagrams/main.hcl",
    content: `view "main" {
  system = "demo"

  node "demo/sensor" {
    x          = 80
    y          = 120
    width      = 140
    height     = 90
    text_align = "center"
  }

  node "demo/hub" {
    x          = 360
    y          = 120
    width      = 140
    height     = 90
    text_align = "center"
  }

  annotation {
    x    = 80
    y    = 40
    text = "Book demo: two components, one connection"
  }
}
`,
  },
];

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
    files: SAMPLE_FILES,
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
    files: SAMPLE_FILES,
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

// A clean project shows the classic verdict panel: head, no items,
// completion stats.
export const CleanProject: Story = {
  args: {
    files: SAMPLE_FILES,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText(/No errors, no warnings/);
    await canvas.findByText("Components");
    await canvas.findByText(/100\.0%/);
  },
};

// Dropping the hub description triggers W004, shown directly at the bottom
// with no click needed. (Alert text runs together across <br/> elements,
// so the assertion uses a regex.)
const warningFiles: BookPayloadFile[] = SAMPLE_FILES.map((file) =>
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
    await canvas.findByText(/1 warning/);
    await canvas.findByText(/W004/);
  },
};

// ?open=system.hcl lands directly on the code tab.
export const OpenCodeFile: Story = {
  args: {
    files: SAMPLE_FILES,
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
    files: SAMPLE_FILES,
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
    files: SAMPLE_FILES,
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
const singleFile: BookPayloadFile[] = SAMPLE_FILES.filter((file) =>
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
    files: SAMPLE_FILES,
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
    files: SAMPLE_FILES,
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
    files: SAMPLE_FILES,
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
    files: SAMPLE_FILES,
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
