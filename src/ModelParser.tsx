import { try_load_yaml } from "./yaml-utils.ts";
import { Alert } from "antd";
import * as z from "zod";
import * as yaml from "js-yaml";
import { type SystemModel, SystemModelSchema } from "./Model.ts";

export type ModelParsingResult =
  | SystemModel
  | null
  | z.ZodError
  | yaml.YAMLException;

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
  return model;
}

export function ParsingError({ result }: { result: ModelParsingResult }) {
  if (result instanceof z.ZodError) {
    const listItems = result.issues.map((issue, index) => (
      <div key={index}>
        <Alert
          message={`${issue.path}: ${issue.code}`}
          description={issue.message}
          type="error"
        />
      </div>
    ));
    return listItems;
  } else if (result instanceof yaml.YAMLException) {
    const error_code = (
      <code style={{ whiteSpace: "pre", textAlign: "left" }}>
        {result.toString()}
      </code>
    );
    return (
      <>
        <Alert
          message={`YAML Parsing Error`}
          description={error_code}
          type="error"
        />
      </>
    );
  } else {
    return null;
  }
}
