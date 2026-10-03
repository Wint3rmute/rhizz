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
    // `$app/paths` reads `__SVELTEKIT_PAYLOAD__` when its module is
    // evaluated. Since SvelteKit 3 that constant is defined by
    // `vite-plugin-sveltekit-compile`, and `@storybook/sveltekit` removes
    // exactly that plugin (the preview is not the app), so any story that
    // touches `resolve()` — Navbar, Inventory, Explore, … — dies on
    // `ReferenceError: __SVELTEKIT_PAYLOAD__ is not defined`.
    //
    // `undefined` is the honest value here: the payload only carries
    // `base`/`assets`, both of which the surrounding defines already
    // resolve to empty in a Storybook build. `config.define` is deep-merged
    // with what the SvelteKit plugin contributes, so this key survives.
    config.define = { ...config.define, __SVELTEKIT_PAYLOAD__: "undefined" };
    return config;
  },
};
