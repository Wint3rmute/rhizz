type Components = Record<string, Component>;
type Ports = Record<string, Port>;

export class Model {
  name: string;
  components: Components = {};
}

export class Component {
  name: string;
  ports: Ports = {};
}

export class Port {
  name: string;
}

function render_component(component: Component): string {
  let out = "";

  if (Object.keys(component.ports).length == 0) {
    console.log(component.name);
    out += component.name;
  } else {
    out += `subgraph cluster_${component.name} {
        label = "${component.name}"`;

    Object.keys(component.ports).forEach((key) => {
      let port = component.ports[key];
      out += ` ${port.name} `;
    });

    out += "}";
  }

  return out;
}

export function graph(model: Model): string {
  let out = "digraph {";

  Object.keys(model.components).forEach((key) => {
    console.log("component")
    console.log(key)
    let component = model.components[key];
    out += render_component(component);
  });

  out += "}";
  return out;
}
