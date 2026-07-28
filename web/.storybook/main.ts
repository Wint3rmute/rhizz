const appBase = process.env.BASE_PATH?.trim() || "";
const storybookBase = appBase
  ? `${appBase.replace(/\/$/, "")}/storybook/`
  : "/storybook/";

export default {
  stories: ["../src/**/*.stories.@(js|jsx|ts|tsx|svelte)"],
  framework: {
    name: "@storybook/sveltekit",
    options: {},
  },
  async viteFinal(config) {
    config.base = storybookBase;
    return config;
  },
};
