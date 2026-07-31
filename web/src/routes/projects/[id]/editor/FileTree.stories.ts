import type { Meta, StoryObj } from "@storybook/svelte";
import { expect, fn, userEvent, within } from "storybook/test";
import type { Dirent } from "../../../../vfs/fs";
import FileTree from "./FileTree.svelte";

// A minimal stand-in for a real ProjectFs.readdir(".", { recursive: true })
// result — FileTree only ever needs { name, path, isFile(), isDirectory() },
// never an id/parentId, so a plain fixture like this is enough to exercise
// it completely in isolation, with no ProjectFs/ProjectStore in sight.
function dirent(path: string, kind: "file" | "directory"): Dirent {
  const segments = path.split("/");
  return {
    name: segments[segments.length - 1],
    path,
    isFile: () => kind === "file",
    isDirectory: () => kind === "directory",
  };
}

const SAMPLE_ENTRIES: Dirent[] = [
  dirent("components", "directory"),
  dirent("components/imu.hcl", "file"),
  dirent("components/esc.hcl", "file"),
  dirent("empty-folder", "directory"),
  dirent("drone.hcl", "file"),
];

const meta = {
  title: "Editor/FileTree",
  component: FileTree,
  args: {
    entries: SAMPLE_ENTRIES,
    selectedPath: "drone.hcl",
    oncreatefile: fn(),
    oncreatedirectory: fn(),
    onrename: fn(),
    ondelete: fn(),
  },
} satisfies Meta<typeof FileTree>;

export default meta;

type Story = StoryObj<typeof meta>;

// Exercises FileTree entirely on its own — no ProjectFs, no ProjectState,
// no +page.svelte — proving it really can be used in isolation, the way
// its own header comment claims. Every callback prop is a `fn()` mock, so
// each interaction below can assert both the DOM's own reaction (e.g. the
// clicked file becoming aria-current) and that the right callback fired
// with the right argument, without either the component or this story
// needing any I/O.
export const Default: Story = {
  args: {},
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);

    // Directories/files nest as expected, sorted directories-first.
    expect(canvas.getByText("components")).toBeInTheDocument();
    expect(canvas.getByText("imu.hcl")).toBeInTheDocument();

    // Selecting a file is a purely internal DOM change (selectedPath is
    // bindable, not driven by a callback) — verified via aria-current
    // rather than a callback assertion.
    const escFile = canvas.getByRole("button", { name: "esc.hcl" });
    expect(escFile).not.toHaveAttribute("aria-current");
    await userEvent.click(escFile);
    expect(escFile).toHaveAttribute("aria-current", "true");

    // The root-level toolbar creates at the project root ("").
    await userEvent.click(canvas.getByRole("button", { name: "+ File" }));
    expect(args.oncreatefile).toHaveBeenLastCalledWith("");

    await userEvent.click(canvas.getByRole("button", { name: "+ Folder" }));
    expect(args.oncreatedirectory).toHaveBeenLastCalledWith("");

    // Per-row hover actions: hidden until the row is hovered (CSS
    // `group-hover/row:flex`), same as real mouse use — userEvent.hover
    // triggers that before clicking through to the underlying action.
    const droneRow = canvas.getByRole("button", { name: "drone.hcl" })
      .closest("div")!;
    await userEvent.hover(droneRow);
    await userEvent.click(within(droneRow).getByTitle("Rename"));
    expect(args.onrename).toHaveBeenLastCalledWith("drone.hcl");

    await userEvent.click(within(droneRow).getByTitle("Delete"));
    expect(args.ondelete).toHaveBeenLastCalledWith("drone.hcl");

    // A directory's hover actions create scoped to that directory, not
    // the root.
    const componentsRow = canvas.getByText("components").closest("div")!;
    await userEvent.hover(componentsRow);
    await userEvent.click(within(componentsRow).getByTitle("New file"));
    expect(args.oncreatefile).toHaveBeenLastCalledWith("components");
  },
};

export const Empty: Story = {
  args: {
    entries: [],
    selectedPath: null,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByText("No files yet.")).toBeInTheDocument();
  },
};

export const NoSelection: Story = {
  args: {
    selectedPath: null,
  },
};
