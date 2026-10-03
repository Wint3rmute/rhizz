// Storybook is served from the root of whatever host embeds it, and the
// static build resolves its own assets against wherever `iframe.html`/
// `index.html` themselves land.
const storybookBase = "/";

export default {
  stories: ["../src/**/*.stories.@(js|jsx|ts|tsx|svelte)"],
  // The current Storybook core packages do not currently ship a compatible
  // addon-essentials release, so most of the former "essentials" bundle
  // (controls, actions, backgrounds, ...) is left out — "storybook/viewport"
  // is registered explicitly since DiagramToolbar.stories.ts's NarrowCanvas
  // story relies on it (globals.viewport) to constrain the preview to a
  // tablet-width viewport.
  addons: [
    "@storybook/addon-vitest",
    "storybook/viewport",
    "@storybook/addon-docs",
    "@storybook/addon-themes",
  ],
  framework: {
    name: "@storybook/sveltekit",
    options: {},
  },
  async viteFinal(config) {
    config.base = storybookBase;
    config.server = config.server || {};
    config.server.fs = config.server.fs || {};
    config.server.fs.allow = [
      ...(config.server.fs.allow || ["."]),
      "../crates/rhizz-wasm/pkg",
    ];
    // `$app/paths` reads a `__SVELTEKIT_PAYLOAD__` global that SvelteKit's
    // compile plugin normally supplies via Vite's `define` — and that plugin is
    // exactly what `@storybook/sveltekit` removes, since the preview is not
    // the app. Without it any story touching `resolve()` (Navbar, Inventory,
    // Explore, …) dies on a ReferenceError when that module is evaluated.
    //
    // `undefined` is the honest value: the payload carries only `base` and
    // `assets`, and both already resolve to empty in a Storybook build.
    // `config.define` is deep-merged with the SvelteKit plugin's own defines,
    // so this key survives.
    config.define = { ...config.define, __SVELTEKIT_PAYLOAD__: "undefined" };
    return config;
  },
};
