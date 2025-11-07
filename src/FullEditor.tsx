import * as React from "react";
import { useEffect, useState } from "react";
import * as z from "zod";
import { graph } from "./model-visualizer.ts";
import { Col, Row } from "antd";
import * as yaml from "js-yaml";
import { useLocalStorage } from "./UseLocalStorage.ts";
import {
  type ModelParsingResult,
  ModelParsingSuccess,
  try_parse_model,
} from "./model-parser-utils.ts";
import { ParsingError } from "./ModelParser.tsx";
import { Graph } from "./Graph.tsx";
import { ModelCompilationError } from "./model-compiler.ts";

const DEFAULT_EDITOR_CONTENTS = `
name: Rocket

components:
  - name: Thruster
    components:
      - name: Propeller
      - name: VectoringControl
  - name: Communication
    components:
      - name: UHF
  - name: Control
    components:
      - name: OnBoardComputer

connections:
  - name: Telemetry
    from: OnBoardComputer
    to: UHF
  - name: ThrustControl
    from: OnBoardComputer
    to: Propeller
 `.trim();

function FullEditor() {
  const [editor_content, set_editor_content] = useLocalStorage(
    "EDITOR_CONTENTS",
    DEFAULT_EDITOR_CONTENTS,
  );
  const [model, set_model] = useState<ModelParsingResult>(null);

  const [graph_input, set_graph_input] = useState<string>("");

  useEffect(() => {
    console.log("Subscribing");
    globalThis.electronAPI.onModelFilesUpdate((value) => {
      set_editor_content(`${value}`);
    });
  });

  useEffect(() => {
    const new_model = try_parse_model(editor_content);
    set_model(new_model);

    if (!new_model || !(new_model instanceof ModelParsingSuccess)) {
      return;
    }

    // Valid SystemModel: render the graph
    const graphviz_input = graph(new_model.model);
    set_graph_input(graphviz_input);
  }, [editor_content]);

  return (
    <>
      <h1>Rhizz</h1>
      <Row>
        <Col span={24}>
          <ParsingError result={model} />
          <Graph graphviz_input={graph_input} />
        </Col>
      </Row>
    </>
  );
}

export default FullEditor;
