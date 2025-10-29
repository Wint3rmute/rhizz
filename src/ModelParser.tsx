import { type SystemModel } from "./Model.ts";
import { Alert } from "antd";
import * as z from "zod";
import * as yaml from "js-yaml";

type ModelParsingResult = SystemModel | null | z.ZodError | yaml.YAMLException;

export function try_load_yaml(input: string): object | yaml.YAMLException {
  try {
    const doc: object = yaml.load(input) as object;
    return doc;
  } catch (e) {
    if (e instanceof yaml.YAMLException) {
      console.log("YAML Exception!");
      return e;
    } else {
      throw e;
    }
  }
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
