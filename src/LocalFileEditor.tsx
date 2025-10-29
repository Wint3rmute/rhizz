import { useEffect, useState } from "react";
import * as z from "zod";
import { graph } from "./Model.ts";
import { Col, Row } from "antd";
import * as yaml from "js-yaml";
import {
  type ModelParsingResult,
  try_parse_model,
} from "./model-parser-utils.ts";
import { ParsingError } from "./ModelParser.tsx";
import { Graph } from "./Graph.tsx";
import RocketSystem from "./rocket.yml?raw";

function LocalFileEditor() {
  const [editor_content, set_editor_content] = useState(
    "",
  );
  const [model, set_model] = useState<ModelParsingResult>(null);
  const [graph_input, set_graph_input] = useState<string>(
    "digraph G { a -> b; }",
  );

  /* This part just won't work */
  if (import.meta.hot) {
    console.log("Hot reload");
    useEffect(() => {
      console.log("Setting editor content");
      set_editor_content(RocketSystem.trim() + ` ${import.meta.hot}`);
    }, [editor_content]);
  }

  useEffect(() => {
    console.log("Parsing model...");
    const new_model = try_parse_model(editor_content);
    set_model(new_model);

    if (
      !new_model ||
      new_model instanceof z.ZodError ||
      new_model instanceof yaml.YAMLException
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
