import init, { CompileResultJS } from "rhizz";
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
): CompileResultJS {
  const compilation_result = CompileResultJS.compile(sources);

  let test_struct = CompileResultJS.get_test_struct();
  console.log(test_struct);

  return compilation_result;
}
