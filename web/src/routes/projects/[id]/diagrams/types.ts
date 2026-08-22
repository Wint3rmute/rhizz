import type { Box, TextAlign } from "./geometry";

export interface DiagramStaticComponent {
  label: string;
  /** Index (into `components`) of this component's parent, if it has one — used only to decide render order (children drawn on top of their parent). */
  parent_component_index?: number;
}

export interface DiagramStaticConnection {
  from: number;
  to: number;
  label: string;
}

/** A placed node's position/size/label alignment — `textAlign` defaults to "center" when omitted. */
export type DiagramStaticBox = Box & { textAlign?: TextAlign };
