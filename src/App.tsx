import { useState } from "react";
import reactLogo from "./assets/react.svg";
import viteLogo from "/vite.svg";
import "./App.css";
import * as Viz from "@viz-js/viz";
import { Model, Component, graph, Port} from './Model.ts';

function App() {
  const [count, setCount] = useState(0);

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

  Viz.instance().then((viz) => {
    const system_graph = graph(model);
    const svg = viz.renderSVGElement(system_graph);

    let parent = document.getElementById("graph");
    if (parent.firstChild) {
      parent.replaceChild(svg, parent.firstChild);
    } else {
      parent.appendChild(svg);
    }
  });

  return (
    <>
      <h1>Rhizz</h1>
      <div className="card">
        <p>
          Edit <code>src/App.tsx</code> and save to test HMR
        </p>
      </div>
      <p id="graph">
        Graph here?
      </p>
    </>
  );
}

export default App;
