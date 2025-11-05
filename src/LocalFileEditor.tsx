import { useEffect, useState } from "react";
import * as z from "zod";
import { graph } from "./model-visualizer.ts";
import { Col, Row } from "antd";
import * as yaml from "js-yaml";
import {
  type ModelParsingResult,
  try_parse_model,
} from "./model-parser-utils.ts";
import { ParsingError } from "./ModelParser.tsx";
import { Graph } from "./Graph.tsx";
import { rocket_model } from "./rocket.ts";
import { ModelCompilationError } from "./model-compiler.ts";

function LocalFileEditor() {
  const [editor_content, set_editor_content] = useState(
    rocket_model,
  );
  const [model, set_model] = useState<ModelParsingResult>(null);
  const [graph_input, set_graph_input] = useState<string>(
    "digraph G { a -> b; }",
  );

  // This is hacky but I want to make IDE changes and see diagrams live-reload
  // in the app. Disabling a bit of eslint rules makes sense here.
  if (import.meta.hot) {
    useEffect(() => {
      console.log("Setting editor content");
      set_editor_content(rocket_model.trim());
    }, [rocket_model]);
  }

  useEffect(() => {
    console.log("Parsing model...");
    const new_model = try_parse_model(editor_content);
    set_model(new_model);

    if (
      !new_model ||
      new_model instanceof z.ZodError ||
      new_model instanceof yaml.YAMLException ||
      new_model instanceof ModelCompilationError
    ) {
      return;
    }

    const graphviz_input = graph(new_model);
    console.log("Setting graph input...");
    set_graph_input(graphviz_input);
  }, [editor_content]);

  return (
    <>
      <h1>Rhizz Local</h1>
      <Row>
        <Col span={24}>
          <ParsingError result={model} />
          <Graph graphviz_input={graph_input} />
        </Col>
      </Row>
    </>
  );
}

export default LocalFileEditor;
