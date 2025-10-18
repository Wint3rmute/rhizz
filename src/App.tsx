import { useEffect, useRef, useState } from "react";
import "./App.css";
import * as Viz from "@viz-js/viz";
import { Component, graph, Model, Port } from "./Model.ts";
import Editor from "@monaco-editor/react";
// import { Button } from 'antd';
import { Flex, Grid, Row, Col } from "antd";
import * as yaml from "js-yaml";

function Ed(
  { on_editor_change }: { on_editor_change: (value: string) => void },
) {
  let handleEditorChange = (value: string | undefined, _event: any) => {
    if (value) {
      on_editor_change(value);
    }
    // console.log(value, event);
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

function App() {
  const [yaml_ok, set_yaml_ok] = useState(false);
  const [editor_content, set_editor_content] = useState("");
  const [model, set_model] = useState(new Model());
  const graph_ref = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    // Get document, or throw exception on error
    try {

      Viz.instance().then((viz) => {
        let new_model = new Model();
        new_model.components = {};
        new_model.name = "Drone";

        let component = new Component();
        component.name = "Drone";
        component.ports = {};

        const doc = yaml.load(editor_content, 'utf8');
        let yaml_model: string[] = doc.model;
        yaml_model.forEach((port_name) => {
          console.log(`got port ${port_name}`);
          let port = new Port();
          port.name = port_name;
          component.ports[port_name] = port;
        })

        new_model.components["drone"] = component;
        set_model(new_model);
        console.log(new_model);
        set_yaml_ok(true);


        const system_graph = graph(new_model);
        console.log(system_graph);

        const svg = viz.renderSVGElement(system_graph);

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
          <p ref={graph_ref}>
            Graph here?
          </p>
        </Col>
        <Col span={12}>
          <Ed on_editor_change={set_editor_content} />
        </Col>
      </Row >
    </>
  );
}

export default App;
