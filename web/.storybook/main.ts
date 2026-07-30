// GitHub Actions sets this to "true" for every workflow run (see
// https://docs.github.com/en/actions/reference/variables-reference).
// Only that specific CI job nests this build under /storybook/ on the
// same GitHub Pages deployment as the main app (see frontend.yml) —
// everywhere else (local builds, Chromatic, ...) the static output gets
// served from an arbitrary/unknown root, so a relative base is what
// actually works there: it resolves against wherever iframe.html/
// index.html themselves end up, instead of assuming a fixed path.
const isGitHubActionsCI = process.env.GITHUB_ACTIONS === "true";
const appBase = process.env.BASE_PATH?.trim() || "";
const storybookBase = isGitHubActionsCI
  ? (appBase ? `${appBase.replace(/\/$/, "")}/storybook/` : "/storybook/")
  : "./";

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
