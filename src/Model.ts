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
  name: string,
  children: Component[] | undefined,
): string {
  let out = "";

  if (children === undefined) {
    out += ` ${name} `;
  } else if (children.length === 0) {
    out += ` ${name} `;
  } else {
    out += ` subgraph cluster_${name} { `;
    out += `label = "${name}" `;

    children.map((component) => {
      out += render_component(component.name, component.components);
    });
    out += ` } `;
  }

  return out;
}

export function graph(model: SystemModel): string {
  let out = "digraph { ";

  out += render_component(model.name, model.components);

  out += "}";
  return out;
}
