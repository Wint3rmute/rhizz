import { Alert } from "antd";
import * as z from "zod";
import * as yaml from "js-yaml";
import { type SystemModel } from "./Model.ts";
import { type SystemModelSchema } from "./Model.ts";

export type ModelParsingResult = SystemModel | null | z.ZodError | yaml.YAMLException;

export function ParsingError(
  { result }: { result: ModelParsingResult },
) {
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

export function try_parse_yaml(input: string): object | yaml.YAMLException {
  try {
    const document: object = yaml.load(input);
    return document;
  } catch (e) {
    if (e instanceof yaml.YAMLException) {
      console.log("YAML Exception!");
      return e;
    } else {
      throw new Error("???");
    }
  }
}

export function try_parse_model(editor_content: string): ModelParsingResult {
  try {
    const doc = yaml.load(editor_content);
    console.log(doc);
    // return doc;
  } catch (e) {
    if (e instanceof yaml.YAMLException) {
      console.log("YAML Exception!");
      return e;
    } else {
      throw new Error("???");
    }
  }

  return null;


  // console.log(doc);
  // const result = SystemModelSchema.safeParse(doc);
  // if (!result.success) {
  //   return result.error;
  // } else {
  //   console.log("Model set");
  //   const new_model: SystemModel = result.data;
  //   return new_model;

  // TODO: move to render function
  // const graphviz_input = graph(new_model);
  // const svg = viz.renderSVGElement(graphviz_input, { engine: "dot" }); // Try "fdp"
  // console.log(graphviz_input);

  // const parent = graph_ref.current;
  // if (!parent) {
  //   // TODO: raise error?
  //   throw new Error("???");
  // }

  // if (parent.firstChild) {
  //   parent.replaceChild(svg, parent.firstChild);
  // } else {
  //   parent.appendChild(svg);
  // }

}
