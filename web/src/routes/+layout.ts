import init from "rhizz";

export const ssr = false;
export const prerender = false;

export async function load() {
  await init();
  return {};
}
