import type { Meta, StoryObj } from "@storybook/svelte";
import type { DiagnosticJS } from "rhizz";
import CompilationDiagnosticsOutline from "./CompilationDiagnosticsOutline.svelte";

type StoryDiagnostic = Pick<DiagnosticJS, "code" | "message">;

const sampleDiagnostics = [
  { code: "E100", message: "A required port is missing." },
  { code: "W200", message: "A component could be decomposed further." },
] satisfies StoryDiagnostic[];

const meta = {
  title: "Components/CompilationDiagnosticsOutline",
  component: CompilationDiagnosticsOutline,
  args: {
    diagnostics: sampleDiagnostics as DiagnosticJS[],
  },
} satisfies Meta<typeof CompilationDiagnosticsOutline>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  args: {
    diagnostics: [] as DiagnosticJS[],
  },
};

export const Default: Story = {};
