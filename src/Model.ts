import * as z from "zod";

type Components = Record<string, Component>;

export const Component = z.object({
  name: z.string(),
  get components(){
    return z.optional(z.array(Component))
  }
}); // .strict();
type Component = z.infer<typeof Component>;

export const SystemModel = z.object({
  name: z.string(),
  components: z.array(Component),
}).strict();
type SystemModel = z.infer<typeof SystemModel>;

export class Model {
  name!: string;
  components: Components = {};
}

export class Port {
  name!: string;
}

export function render_component(name: string, children: Component[] | undefined): string {
  let out = "";

  if (children === undefined) {
    out += ` ${name} `;
  } else if  (children.length == 0){
    out += ` ${name} `;
  } else {
    out += ` subgraph cluster_${name} { `;
    out += `label = "${name}" `

    children.map((component) => {
      out += render_component(component.name, component.components)
    });
    out += ` } `;
  }

  return out;
}

export function graph(model: SystemModel): string {
  let out = "digraph { ";

  out += render_component(model.name, model.components)

  out += "}";
  return out;
}
