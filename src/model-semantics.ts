// Once a model is parsed in model-syntax,
// it is parsed to a semantically correct form
// specified here
import * as z from "zod";

export const ComponentSchema = z.object({
  name: z.string(),
  get components() {
    return z.optional(z.array(ComponentSchema));
  },
}); // .strict();
export type Component = z.infer<typeof ComponentSchema>;

export const ProtocolSchema = z.object({
  name: z.string(),
  is_abstract: z.boolean().optional().default(true),
  can_encapsulate: z.array(z.string()).optional().default([]),
}).strict();
export type Protocol = z.infer<typeof ProtocolSchema>;

export const ConnectionSchema = z.object({
  name: z.string(),
  from: z.string(),
  to: z.string(),
  protocol: ProtocolSchema.optional(),
}).strict();
export type Connection = z.infer<typeof ConnectionSchema>;

export const SystemModelSchema = z.object({
  name: z.string(),
  // Allows finding components by name
  components_index: z.record(z.string(), ComponentSchema),
  protocols: z.array(ProtocolSchema),
  components: z.array(ComponentSchema),
  connections: z.array(ConnectionSchema),
}).strict();
export type SystemModel = z.infer<typeof SystemModelSchema>;
