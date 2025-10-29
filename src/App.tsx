import { useEffect, useRef, useState } from "react";
import "./App.css";
import * as Viz from "@viz-js/viz";
import * as z from "zod";
import { graph, type SystemModel, SystemModelSchema } from "./Model.ts";
import { Col, Row } from "antd";
import * as yaml from "js-yaml";
import { useLocalStorage } from "./UseLocalStorage.ts";
import { ParsingError, try_load_yaml } from "./ModelParser.tsx";
import { ModelEditor } from "./ModelEditor.tsx";

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

type ModelParsingResult = SystemModel | null | z.ZodError | yaml.YAMLException;

function try_parse_model(editor_content: string): ModelParsingResult {
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

function App() {
  const [editor_content, set_editor_content] = useLocalStorage(
    "EDITOR_CONTENTS",
    DEFAULT_EDITOR_CONTENTS,
  );
  const [model, set_model] = useState<ModelParsingResult>(null);
  const graph_ref = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    Viz.instance().then((viz) => {
      const new_model = try_parse_model(editor_content);
      set_model(new_model);

      const graphviz_input = graph(new_model);
      const svg = viz.renderSVGElement(graphviz_input, { engine: "dot" }); // Try "fdp"
      console.log(graphviz_input);
      const parent = graph_ref.current;
      if (!parent) {
        // TODO: raise error?
        return;
      }
      if (parent.firstChild) {
        parent.replaceChild(svg, parent.firstChild);
      } else {
        parent.appendChild(svg);
      }
    });
  }, [editor_content]);

  return (
    <>
      <h1>Rhizz</h1>
      <Row>
        <Col span={12}>
          <ParsingError result={model} />
          <p ref={graph_ref}>
            Graph here?
          </p>
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

export default App;
