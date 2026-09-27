import "../src/app.css";
import init from "rhizz";
import { withThemeByDataAttribute } from "@storybook/addon-themes";

// Global initialization for Storybook stories
await init();

// Vitest's browser (and Playwright) set webdriver. Play functions assert
// settled geometry, and diagram transitions honor this media query by cutting.
if (navigator.webdriver) {
  const nativeMatchMedia = window.matchMedia.bind(window);
  window.matchMedia = (query: string) => {
    if (query.includes("prefers-reduced-motion")) {
      return {
        matches: true,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      };
    }
    return nativeMatchMedia(query);
  };
}

export default {
  tags: ["autodocs"],
  loaders: [
    async () => {
      await init();
      return {};
    },
  ],
  decorators: [
    // Toggles daisyUI's `data-theme` attribute on <html> (the same mechanism
    // the app's ThemeState uses), so the theme toolbar switcher re-renders
    // every component with the selected theme's colors — not just the
    // preview background.
    withThemeByDataAttribute({
      themes: { dark: "dark", light: "light" },
      defaultTheme: "dark",
    }),
  ],
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    options: {
      storySort: (a, b) => a.id.localeCompare(b.id),
    },
  },
};
