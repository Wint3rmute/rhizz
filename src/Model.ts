import * as z from "zod";

export const ComponentSchema = z.object({
  name: z.string(),
  get components() {
    return z.optional(z.array(ComponentSchema));
  },
}); // .strict();
export type Component = z.infer<typeof ComponentSchema>;

export const ConnectionSchema = z.object({
  name: z.string(),
  from: z.string(),
  to: z.string(),
}).strict();
export type Connection = z.infer<typeof ConnectionSchema>;

export const ProtocolSchema = z.object({
  name: z.string(),
  is_abstract: z.boolean().optional().default(true),
  can_encapsulate: z.array(z.string()).optional().default([]),
}).strict()
export type Protocol = z.infer<typeof ProtocolSchema>;

export const SystemModelSchema = z.object({
  name: z.string(),
  components: z.array(ComponentSchema),
  connections: z.array(ConnectionSchema).optional().default([]),
  protocols: z.array(ProtocolSchema).optional().default([]),
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
