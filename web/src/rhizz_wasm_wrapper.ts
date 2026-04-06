import { CompileResultJS } from "rhizz";

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
): CompileResultJS {
  const compilation_result = CompileResultJS.compile(sources);

  const model = compilation_result.model();

  if (model !== undefined) {
    const c = model.component_by_name("test");
    if (c !== undefined) {
    }
  }

  return compilation_result;
}
