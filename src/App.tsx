import { useEffect, useRef, useState } from "react";
import "./App.css";
import * as Viz from "@viz-js/viz";
import * as z from "zod";
import { graph, type SystemModel, SystemModelSchema } from "./Model.ts";
import { Col, Row } from "antd";
import * as yaml from "js-yaml";
import { Alert } from "antd";
import { useLocalStorage } from "./UseLocalStorage.ts";
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

function ParsingError({ result }: { result: ModelParsingResult }) {
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

function App() {
  const [yaml_ok, set_yaml_ok] = useState(false);
  const [editor_content, set_editor_content] = useLocalStorage(
    "EDITOR_CONTENTS",
    DEFAULT_EDITOR_CONTENTS,
  );
  const [model, set_model] = useState<ModelParsingResult>(null);
  const graph_ref = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    Viz.instance().then((viz) => {
      try {
        const doc = yaml.load(editor_content);
        console.log(doc);
        const result = SystemModelSchema.safeParse(doc);
        if (!result.success) {
          set_model(result.error);
        } else {
          console.log("Model set");
          const new_model: SystemModel = result.data;
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
        }
      } catch (e) {
        if (e instanceof yaml.YAMLException) {
          console.log("YAML Exception!");
          set_model(e);
          set_yaml_ok(false);
        } else {
          console.error(e);
        }
      }
    });
  }, [editor_content]);

  return (
    <>
      <h1>Rhizz{yaml_ok ? "!" : "?"}</h1>
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
