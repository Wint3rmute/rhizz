import "../src/app.css";
import init from "rhizz";

// Global initialization for Storybook stories
await init();

export default {
  tags: ["autodocs"],
  loaders: [
    async () => {
      await init();
      return {};
    },
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
