import { useEffect, useRef, useState } from "react";
import "./App.css";
import * as Viz from "@viz-js/viz";
import { Col, Row } from "antd";
import * as yaml from "js-yaml";
import { useLocalStorage } from "./UseLocalStorage.ts";
import rocket from "./examples/rocket.yml?raw";
import CodeEditor from "./Editor.tsx";
import { ParsingError, try_parse_yaml } from "./ModelParser.tsx";
import { type ModelParsingResult } from './ModelParser.tsx';
import { type SystemModelSchema } from "./Model.ts";

const DEFAULT_EDITOR_CONTENTS = rocket.trim();

function App() {
  const [yaml_ok, set_yaml_ok] = useState(false);
  const [editor_content, set_editor_content] = useLocalStorage(
    "EDITOR_CONTENTS",
    DEFAULT_EDITOR_CONTENTS,
  );

  // const [editor_content, set_editor_content] = useState(
  //   DEFAULT_EDITOR_CONTENTS,
  // );

  const [model, set_model] = useState<ModelParsingResult>(null);
  const graph_ref = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    Viz.instance().then((viz) => {
      try_parse_yaml(editor_content)
      console.log(viz);
    });
  });

  // useEffect(() => {
  //   Viz.instance().then((viz) => {
  //     try {
  //       const doc = yaml.load(editor_content);
  //       console.log(doc);
  //       const result = SystemModelSchema.safeParse(doc);
  //       if (!result.success) {
  //         set_model(result.error);
  //       } else {
  //         console.log("Model set");
  //         const new_model: SystemModel = result.data;
  //         set_model(new_model);

  //         const graphviz_input = graph(new_model);
  //         const svg = viz.renderSVGElement(graphviz_input, { engine: "dot" }); // Try "fdp"
  //         console.log(graphviz_input);

  //         const parent = graph_ref.current;
  //         if (!parent) {
  //           // TODO: raise error?
  //           return;
  //         }

  //         if (parent.firstChild) {
  //           parent.replaceChild(svg, parent.firstChild);
  //         } else {
  //           parent.appendChild(svg);
  //         }
  //       }
  //     } catch (e) {
  //       if (e instanceof yaml.YAMLException) {
  //         console.log("YAML Exception!");
  //         set_model(e);
  //         set_yaml_ok(false);
  //       } else {
  //         console.error(e);
  //       }
  //     }
  //   });
  // }, [editor_content]);

  // if (import.meta.hot) {
  //   console.log("Setting editor content");
  //   useEffect(() => {
  //     set_editor_content(DEFAULT_EDITOR_CONTENTS.trim());
  //   }, [DEFAULT_EDITOR_CONTENTS]);
  // }

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
          <CodeEditor
            default_value={editor_content}
            on_editor_change={set_editor_content}
          />
        </Col>
      </Row>
    </>
  );
}

export default App;
