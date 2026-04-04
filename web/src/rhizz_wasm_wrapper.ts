// @ts-nocheck
import init, { compile_sources } from "rhizz";
await init();

interface CompilationError {
  diagnostics: {
    code: string;
    message: string;
  }[];
}

interface CompiledSystem {
  model: {
    project: {
      name: string;
      version: string;
      authors: string[];
    };
    systems: [];
    components: [];
    ports: [];
    connections: [];
    messages: [];
    fields: [];
    views: [];
  };
  diagnostics: {
    code: string;
    message: string;
  }[];
}

export function compile_system(
  sources: { filename: string; content: string }[],
): CompilationError | CompiledSystem {
  return compile_sources(sources);
}
