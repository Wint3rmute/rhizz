import type { Component, SystemModel } from "./model-semantics.ts";

export function render_component(
  component: Component,
): string {
  console.log(`Rendering ${component.name}`);
  let out = "";

  if (component.components === undefined) {
    out += ` ${component.name} `;
  } else if (component.components.length === 0) {
    out += ` ${component.name} `;
  } else {
    out += ` subgraph cluster_${component.name} { `;
    out += `label = "${component.name}" `;

    component.components.forEach((component) => {
      out += render_component(component);
    });
    out += ` } `;
  }

  return out;
}

export function graph(model: SystemModel): string {
  let out = `
  digraph { rankdir="LR"
     graph [fontname = "monospace"];
     node [fontname = "monospace"];
     edge [fontname = "monospace"];
     compound=true;
  `;

  out += ` subgraph cluster_${model.name} { label = "${model.name}" `;

  model.components.forEach((component) => {
    out += render_component(component);
  });

  out += "}";

  model.connections.forEach((connection) => {
    out +=
      ` ${connection.from} -> ${connection.to} [label="${connection.name}"]; `;
  });

  out += "}";
  return out;
}
