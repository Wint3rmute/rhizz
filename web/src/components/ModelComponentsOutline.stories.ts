import type { Meta, StoryObj } from "@storybook/svelte";
import type { ComponentJS, ModelJS } from "rhizz";
import ModelComponentsOutline from "./ModelComponentsOutline.svelte";

type StoryComponent = Pick<ComponentJS, "label">;

const sampleComponents = [
  { label: "API Gateway" },
  { label: "Orders Service" },
  { label: "Payments Service" },
] satisfies StoryComponent[];

function createModelMock(components: StoryComponent[]): ModelJS {
  return {
    components: () => components as ComponentJS[],
  } as ModelJS;
}

const meta = {
  title: "Components/ModelComponentsOutline",
  component: ModelComponentsOutline,
  args: {
    model: createModelMock(sampleComponents),
  },
} satisfies Meta<typeof ModelComponentsOutline>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
