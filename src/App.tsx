import { useEffect, useRef } from "react";
import "./App.css";
import * as Viz from "@viz-js/viz";
import { Component, graph, Model, Port } from "./Model.ts";
import Editor from "@monaco-editor/react";
import { Button } from 'antd';
import { Grid } from "antd";

function Ed() {
  return (
    <Editor
      height="90vh"
      defaultLanguage="javascript"
      defaultValue="// some comment"
    />
  );
}

function App() {
  // const [count, setCount] = useState(0);

  let model = new Model();
  let component = new Component();
  component.name = "Drone";

  let uart = new Port();
  uart.name = "UART";
  component.ports["uart"] = uart;

  let spi = new Port();
  spi.name = "SPI";
  component.ports["SPI"] = spi;

  model.components["drone"] = component;

  const graph_ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    Viz.instance().then((viz) => {
      const system_graph = graph(model);
      const svg = viz.renderSVGElement(system_graph);

      let parent = graph_ref.current; //document.getElementById("graph");
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
  }, [graph_ref]);

  return (
    <>
      <h1>Rhizz</h1>
      <div className="card">
        <p>
          Edit <code>src/App.tsx</code> and save to test HMR
        </p>
      </div>
        <Button type="primary">PRESS ME</Button>
      <p ref={graph_ref}>
        Graph here?
      </p>
    </>
  );
}

export default App;
