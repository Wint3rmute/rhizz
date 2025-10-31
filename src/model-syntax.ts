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
}).strict();
export type Protocol = z.infer<typeof ProtocolSchema>;

export const SystemModelSchema = z.object({
  name: z.string(),
  components: z.array(ComponentSchema),
  connections: z.array(ConnectionSchema).optional().default([]),
  protocols: z.array(ProtocolSchema).optional().default([]),
}).strict();
export type SystemModel = z.infer<typeof SystemModelSchema>;
