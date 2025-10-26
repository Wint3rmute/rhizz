import * as z from "zod";

export const ComponentSchema = z.object({
  name: z.string(),
  get components() {
    return z.optional(z.array(ComponentSchema));
  },
}); // .strict();
export type Component = z.infer<typeof ComponentSchema>;

export const SystemModelSchema = z.object({
  name: z.string(),
  components: z.array(ComponentSchema),
}).strict();
export type SystemModel = z.infer<typeof SystemModelSchema>;

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
  let out = 'digraph { rankdir="LR" ';

  out += ` subgraph cluster_${model.name} { label = "${model.name}" `;

  model.components.forEach((component) => {
    out += render_component(component);
  });

  out += "}";

  out += "}";
  return out;
}
