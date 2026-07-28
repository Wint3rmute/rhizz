const appBase = process.env.BASE_PATH?.trim() || "";
const storybookBase = appBase
  ? `${appBase.replace(/\/$/, "")}/storybook/`
  : "/storybook/";

export default {
  stories: ["../src/**/*.stories.@(js|jsx|ts|tsx|svelte)"],
  // The current Storybook core packages do not currently ship a compatible
  // addon-essentials release, so the default addon set is left empty.
  addons: [],
  framework: {
    name: "@storybook/sveltekit",
    options: {},
  },
  async viteFinal(config) {
    config.base = storybookBase;
    return config;
  },
};
