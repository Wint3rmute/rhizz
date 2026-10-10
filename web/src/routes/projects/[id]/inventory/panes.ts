// The Inventory workspace's side-panel layout store: panel widths and
// hidden flags, persisted across reloads. One line because the shape,
// clamping and storage idiom are shared (see `components/modular_ui/`);
// only the storage key is inventory-specific.
import { createPaneLayout } from "../../../../components/modular_ui/paneLayout";

export const inventoryPanes = createPaneLayout({
  key: "rhizz-inventory-layout:v1",
});
