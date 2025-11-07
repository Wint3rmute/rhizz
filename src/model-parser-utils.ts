import { try_load_yaml } from "./yaml-utils.ts";
import * as z from "zod";
import * as yaml from "js-yaml";
import { SystemModelSchema } from "./model-syntax.ts";
import type { SystemModel } from "./model-semantics.ts";
import { compile, ModelCompilationError } from "./model-compiler.ts";

export class ModelParsingSuccess {
  constructor(
    public readonly model: SystemModel,
    public readonly extras: string[],
  ) {}
}

export type ModelParsingResult =
  | ModelParsingSuccess
  | null
  | z.ZodError
  | yaml.YAMLException
  | ModelCompilationError;

export function try_parse_model(editor_content: string): ModelParsingResult {
  const yaml_load_result = try_load_yaml(editor_content);
  if (yaml_load_result instanceof yaml.YAMLException) {
    return yaml_load_result;
  }

  const result = SystemModelSchema.safeParse(yaml_load_result);
  if (!result.success) {
    return result.error;
  }
  const syntax_model = result.data;
  try {
    const semantic_model = compile(syntax_model);
    return new ModelParsingSuccess(semantic_model, []);
  } catch (e) {
    if (e instanceof ModelCompilationError) {
      return e;
    } else {
      throw e;
    }
  }
}
