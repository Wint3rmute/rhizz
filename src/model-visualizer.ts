import type { Component, SystemModel } from "./model-semantics.ts";

export function render_component(
  component: Component,
): string {
  let out = "";

  if (component.components === undefined) {
    out += ` ${component.name} `;
  } else if (component.components.length === 0) {
    out += ` ${component.name} `;
  } else {
    out += ` subgraph cluster_${component.name} { `;
    out += `label = "${component.name}" `;

    // To draw edges between cluster nodes, Graphviz requires that we create a dummy node
    out += ` ${component.name}__dummy [style=invis, shape=point, width=0]; `;

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
     node [shape=box, fixedsize=false, margin=0.3];
     edge [arrowsize=0.8];
     splines=polyline;
  `;

  out += ` subgraph cluster_${model.name} { label = "${model.name}" `;

  model.components.forEach((component) => {
    out += render_component(component);
  });

  out += "}";

  model.connections.forEach((connection) => {
    const from_component = model.components_index[connection.from];
    const to_component = model.components_index[connection.to];

    if (from_component === undefined || to_component === undefined) {
      console.warn(
        `Connection '${connection.name}' references undefined components: from='${connection.from}', to='${connection.to}'`,
      );
      return;
    }

    let style = "dotted";
    if (connection.protocol && !connection.protocol.is_abstract) {
      style = "solid";
    }

    // Logic to determine if we need to connect to dummy nodes
    const connection_from_node =
      from_component.components && from_component.components.length > 0
        ? `${connection.from}__dummy`
        : connection.from;

    const connection_to_node =
      to_component.components && to_component.components.length > 0
        ? `${connection.to}__dummy`
        : connection.to;

    // Create the edge with lhead and ltail to point to either the node or dummy
    out +=
      ` ${connection_from_node} -> ${connection_to_node} [lhead="cluster_${connection.to}", ltail="cluster_${connection.from}", label="${connection.name}", style="${style}"]; `;
  });

  out += "}";
  return out;
}
