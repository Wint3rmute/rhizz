import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import adapter from "@sveltejs/adapter-static";

export default {
  preprocess: vitePreprocess(),
  compilerOptions: {
    experimental: {
      async: true,
    },
  },
  kit: {
    adapter: adapter({ fallback: "index.html" }),
  },
  paths: {
    base: process.argv.includes("dev") ? "" : process.env.BASE_PATH,
  },
};
