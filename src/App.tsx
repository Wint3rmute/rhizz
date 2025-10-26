import { useEffect, useRef, useState } from "react";
import "./App.css";
import * as Viz from "@viz-js/viz";
import * as z from "zod";
import { graph, Model, SystemModel } from "./Model.ts";
import Editor from "@monaco-editor/react";
// import { Button } from 'antd';
import { Col, Row } from "antd";
import * as yaml from "js-yaml";
import { Alert } from "antd";

function Ed(
  { on_editor_change }: { on_editor_change: (value: string) => void },
) {
  let handleEditorChange = (value: string | undefined, _event: any) => {
    if (value) {
      on_editor_change(value);
    }
  };

  const default_value = `model:
  - asd
 `.trim();

  return (
    <Editor
      height="90vh"
      width="80%"
      defaultLanguage="yaml"
      defaultValue={default_value}
      onChange={handleEditorChange}
    />
  );
}

type ModelParsingResult = Model | null | z.ZodError;

function ParsingError({ result }: { result: ModelParsingResult }) {
  if (result instanceof z.ZodError) {
    // console.log(result)
    // console.log(result.issues)

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
  } else {
    return null;
  }
}

function App() {
  const [yaml_ok, set_yaml_ok] = useState(false);
  const [editor_content, set_editor_content] = useState("");
  const [model, set_model] = useState<ModelParsingResult>(new Model());
  const graph_ref = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    // Get document, or throw exception on error
    try {
      Viz.instance().then((viz) => {
        const doc = yaml.load(editor_content, "utf8");
        const result = SystemModel.safeParse(doc);
        if (!result.success) {
          result.error;
          set_model(result.error);
        } else {
          console.log("Model set");
          let model: SystemModel = result.data;
          set_model(model);

          let graphviz_input = graph(model);
          const svg = viz.renderSVGElement(graphviz_input, { engine: "dot" }); // Try "fdp"
          console.log(graphviz_input);

          let parent = graph_ref.current;
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
      });
    } catch (e) {
      console.error(e);
      set_yaml_ok(false);
    }
  }, [editor_content]);

  // useEffect(() => {
  //   Viz.instance().then((viz) => {
  //     const system_graph = graph(model);
  //     console.log(system_graph);

  //     const svg = viz.renderSVGElement(system_graph);

  //     let parent = graph_ref.current; //document.getElementById("graph");
  //     if (!parent) {
  //       // TODO: raise error?
  //       return;
  //     }

  //     if (parent.firstChild) {
  //       parent.replaceChild(svg, parent.firstChild);
  //     } else {
  //       parent.appendChild(svg);
  //     }
  //   });
  // }, [graph_ref, model]);

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
          <Ed on_editor_change={set_editor_content} />
        </Col>
      </Row>
    </>
  );
}

export default App;
