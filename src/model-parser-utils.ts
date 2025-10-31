import { try_load_yaml } from "./yaml-utils.ts";
import * as z from "zod";
import * as yaml from "js-yaml";
import { type SystemModel, SystemModelSchema } from "./model-syntax.ts";
import { compile, ModelCompilationError } from "./model-compiler.ts";

export type ModelParsingResult =
  | SystemModel
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
  const model: SystemModel = result.data;
  try {
    compile(model);
  } catch (e) {
    if (e instanceof ModelCompilationError) {
      return e;
    } else {
      throw e;
    }
  }
  return model;
}
