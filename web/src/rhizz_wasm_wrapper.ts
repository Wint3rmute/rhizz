import { CompileResultJS } from "rhizz";

export function compile_system(
  sources: { filename: string; content: string }[],
): CompileResultJS {
  return CompileResultJS.compile(sources);
}
