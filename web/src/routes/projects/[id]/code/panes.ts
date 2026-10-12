// The Code page's side-panel layout store: the file sidebar's width and
// hidden flag, persisted across reloads. Same shared shape as Modeling and
// Inventory (see `components/modular_ui/`); only the key and defaults are
// code-specific.
import { createPaneLayout } from "../../../../components/modular_ui/paneLayout";

export const codePanes = createPaneLayout({
  key: "rhizz-code-layout:v1",
  defaultLeftWidth: 256,
  defaultRightWidth: 256,
});
