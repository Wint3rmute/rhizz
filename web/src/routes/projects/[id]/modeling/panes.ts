// The Modeling workspace's side-panel layout store: panel widths and
// hidden flags, persisted across reloads. Same shared shape as Inventory
// (see `components/modular_ui/`); only the key and the defaults are
// modeling-specific. Defaults match the old fixed sidebars (`w-64`).
import { createPaneLayout } from "../../../../components/modular_ui/paneLayout";

export const modelingPanes = createPaneLayout({
  key: "rhizz-modeling-layout:v1",
  defaultLeftWidth: 256,
  defaultRightWidth: 256,
});
