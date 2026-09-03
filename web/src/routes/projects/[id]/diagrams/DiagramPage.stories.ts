import type { Meta, StoryObj } from "@storybook/svelte";
import { expect, within } from "storybook/test";
import init from "rhizz";
import type { Project } from "../../../../vfs/types";
import {
  createProjectWithMainFile,
  projectStore,
} from "../../../../ProjectState.svelte";
import DiagramPage from "./+page.svelte";

// Deterministic project ids so story args can be built synchronously at
// module scope while the async seeding runs lazily from loaders (top-level
// await in story files races the vitest-addon's test registration — see
// Explore.stories.ts).
const BROKEN_PROJECT_ID = "story-diagrams-broken";
const LONG_ERROR_PROJECT_ID = "story-diagrams-long-error";

const INVALID_SYSTEM_HCL = `project {
  name = "broken-project"
}

project {
  name = "duplicate-project-block"
}

system "demo" {
  component "frontend" {
    leaf = true
  }
}
`;

const LONG_ERROR_HCL = `project {
  name = "long-error-project"
}

component "this-is-a-very-long-component-name-that-goes-on-and-on-and-on-and-on" {
  port "i2c" {
    role = "provider"
  }
}
component "fc" {
  port "i2c" {
    role = "consumer"
  }
}
system "demo" {
  instance "this-is-a-very-long-component-name-that-goes-on-and-on-and-on-and-on" {
    source = "this-is-a-very-long-component-name-that-goes-on-and-on-and-on-and-on"
  }
  instance "fc" {
    source = "fc"
  }
  connection "sensor-link" {
    from = "this-is-a-very-long-component-name-that-goes-on-and-on-and-on-and-on/spi"
    to   = "fc/i2c"
  }
}
`;

async function ensureBrokenProject(): Promise<Project> {
  await init();
  const existing = await projectStore.listProjects();
  const project = existing.find((candidate) =>
    candidate.id === BROKEN_PROJECT_ID
  );
  return project ?? await createProjectWithMainFile(
    "Broken diagram story",
    INVALID_SYSTEM_HCL,
    BROKEN_PROJECT_ID,
  );
}

async function ensureLongErrorProject(): Promise<Project> {
  await init();
  const existing = await projectStore.listProjects();
  const project = existing.find((candidate) =>
    candidate.id === LONG_ERROR_PROJECT_ID
  );
  return project ?? await createProjectWithMainFile(
    "Long error diagram story",
    LONG_ERROR_HCL,
    LONG_ERROR_PROJECT_ID,
  );
}

const meta = {
  title: "Pages/Diagrams/Compilation Error",
  component: DiagramPage,
  parameters: {
    layout: "fullscreen",
  },
  args: {
    data: {
      projectId: BROKEN_PROJECT_ID,
    },
  },
} satisfies Meta<typeof DiagramPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DuplicateProjectBlock: Story = {
  args: {
    params: {
      id: BROKEN_PROJECT_ID,
    },
    data: {
      projectId: BROKEN_PROJECT_ID,
    },
  },
  loaders: [ensureBrokenProject],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(
      await canvas.findByRole("heading", { name: "Model failed to compile" }),
    ).toBeInTheDocument();
    await expect(canvas.getByText(/1 error detected in the system model/))
      .toBeInTheDocument();
    await expect(canvas.getByText("[E000]"))
      .toBeInTheDocument();

    const editorLink = canvas.getByRole("link", { name: "Open Editor to Fix" });
    await expect(editorLink).toHaveAttribute(
      "href",
      expect.stringContaining(`/projects/${BROKEN_PROJECT_ID}/editor`),
    );
  },
};

export const LongErrorMessageWraps: Story = {
  args: {
    params: {
      id: LONG_ERROR_PROJECT_ID,
    },
    data: {
      projectId: LONG_ERROR_PROJECT_ID,
    },
  },
  loaders: [ensureLongErrorProject],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(
      await canvas.findByRole("heading", { name: "Model failed to compile" }),
    ).toBeInTheDocument();

    const message = canvas.getByText(/^\[E010\]/);
    await expect(message).toBeInTheDocument();
    // The message must wrap (multi-line) rather than truncating on overflow.
    await expect(message).not.toHaveStyle({ "white-space": "nowrap" });
    await expect(message).not.toHaveStyle({ "text-overflow": "ellipsis" });
  },
};

export const CopyDebugInfoButton: Story = {
  args: {
    params: {
      id: BROKEN_PROJECT_ID,
    },
    data: {
      projectId: BROKEN_PROJECT_ID,
    },
  },
  loaders: [ensureBrokenProject],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // The Copy Debug Info button lives beside Embed Diagram in the right
    // sidebar and is always rendered.
    const button = canvas.getByRole("button", { name: "Copy Debug Info" });
    await expect(button).toBeInTheDocument();
    await expect(button).toHaveAttribute(
      "title",
      "Copy the session's model mutations as a replayable TypeScript test",
    );
  },
};
