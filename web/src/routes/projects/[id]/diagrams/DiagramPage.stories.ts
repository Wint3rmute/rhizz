import type { Meta, StoryObj } from "@storybook/svelte";
import { expect, within } from "storybook/test";
import init from "rhizz";
import type { Project } from "../../../../vfs/types";
import {
  createProjectWithMainFile,
  projectStore,
} from "../../../../ProjectState.svelte";
import DiagramPage from "./+page.svelte";

await init();

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
  const existing = await projectStore.listProjects();
  const project = existing.find((candidate) =>
    candidate.name === "Broken diagram story"
  );
  return project ?? await createProjectWithMainFile(
    "Broken diagram story",
    INVALID_SYSTEM_HCL,
  );
}

async function ensureLongErrorProject(): Promise<Project> {
  const existing = await projectStore.listProjects();
  const project = existing.find((candidate) =>
    candidate.name === "Long error diagram story"
  );
  return project ?? await createProjectWithMainFile(
    "Long error diagram story",
    LONG_ERROR_HCL,
  );
}

const brokenProject: Project = await ensureBrokenProject();
const longErrorProject: Project = await ensureLongErrorProject();

const meta = {
  title: "Pages/Diagrams/Compilation Error",
  component: DiagramPage,
  parameters: {
    layout: "fullscreen",
  },
  args: {
    data: {
      projectId: brokenProject.id,
    },
  },
} satisfies Meta<typeof DiagramPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DuplicateProjectBlock: Story = {
  args: {
    params: {
      id: brokenProject.id,
    },
    data: {
      projectId: brokenProject.id,
    },
  },
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
      expect.stringContaining(`/projects/${brokenProject.id}/editor`),
    );
  },
};

export const LongErrorMessageWraps: Story = {
  args: {
    params: {
      id: longErrorProject.id,
    },
    data: {
      projectId: longErrorProject.id,
    },
  },
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
      id: brokenProject.id,
    },
    data: {
      projectId: brokenProject.id,
    },
  },
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
