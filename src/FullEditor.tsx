import { useEffect, useState } from "react";
import * as z from "zod";
import { graph } from "./Model.ts";
import { Col, Row } from "antd";
import * as yaml from "js-yaml";
import { useLocalStorage } from "./UseLocalStorage.ts";
import {
  type ModelParsingResult,
  try_parse_model,
} from "./model-parser-utils.ts";
import { ParsingError } from "./ModelParser.tsx";
import { ModelEditor } from "./ModelEditor.tsx";
import { Graph } from "./Graph.tsx";

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
    const new_model = try_parse_model(editor_content);
    set_model(new_model);

    // Early return if parsing failed — remove any existing SVG so the UI
    // doesn't show stale graphs while there are parsing errors.
    if (
      !new_model ||
      new_model instanceof z.ZodError ||
      new_model instanceof yaml.YAMLException
    ) {
      return;
    }

    // Valid SystemModel: render the graph
    const graphviz_input = graph(new_model);
    set_graph_input(graphviz_input);
  }, [editor_content]);

  return (
    <>
      <h1>Rhizz</h1>
      <Row>
        <Col span={12}>
          <ParsingError result={model} />
          <Graph graphviz_input={graph_input} />
        </Col>
        <Col span={12}>
          <ModelEditor
            default_value={editor_content}
            on_editor_change={set_editor_content}
          />
        </Col>
      </Row>
    </>
  );
}

export default FullEditor;
