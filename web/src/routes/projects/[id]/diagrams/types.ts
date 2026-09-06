import type { Box, TextAlign } from "./geometry";

export interface DiagramStaticComponent {
  label: string;
  icon?: string | undefined;
  color?: string | undefined;
  border?: string | undefined;
  font?: string | undefined;
  /** Index (into `components`) of this component's parent, if it has one — used only to decide render order (children drawn on top of their parent). */
  parent_component_index?: number | undefined;
}

export interface DiagramStaticConnection {
  from: number;
  to: number;
  label: string;
  startSide?: "top" | "bottom" | "left" | "right";
  endSide?: "top" | "bottom" | "left" | "right";
}

/** A placed node's position/size/label alignment — `textAlign` defaults to "center" when omitted. */
export type DiagramStaticBox = Box & { textAlign?: TextAlign };

/** A view-level text annotation placed at an absolute canvas position. */
export interface DiagramStaticAnnotation {
  text: string;
  x: number;
  y: number;
  /** Font size multiplier; 1 = 100% (default). */
  scale?: number;
}
