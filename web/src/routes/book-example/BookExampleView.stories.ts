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
    path: "views/main.hcl",
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
  {
    path: "docs/sensor.md",
    content: "# sensor\n\nTemperature sensor.\n",
  },
  {
    path: "docs/hub.md",
    content: "# hub\n\nReading collector.\n",
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

// Dropping the hub description triggers W004, shown directly at the bottom.
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
