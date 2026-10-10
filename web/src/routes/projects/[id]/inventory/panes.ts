// The Inventory workspace's side-panel layout store: panel widths and
// hidden flags, persisted across reloads. One line because the shape,
// clamping and storage idiom are shared (see `components/paneLayout.ts`);
// only the storage key is inventory-specific.
import { createPaneLayout } from "../../../../components/paneLayout";

export const inventoryPanes = createPaneLayout({
  key: "rhizz-inventory-layout:v1",
});
