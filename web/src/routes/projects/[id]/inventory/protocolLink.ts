// Hrefs into the Inventory, shared by the protocol pane, the connection
// inspector's "Edit protocol" link and any other page that points at a
// protocol. A protocol is addressed by query parameter rather than by path, so
// its label can never be mistaken for a component or system label.
import { resolve } from "$app/paths";
import { protocolInventoryQuery } from "./inventory";

/** The Inventory entity page for `label`, a component or a system. */
export function inventoryEntityHref(
  projectId: string | null,
  label: string,
): string {
  return resolve("/projects/[id]/inventory/[...label]", {
    id: projectId ?? "",
    label,
  });
}

/** The Inventory's Protocols tab, with `label` open when given. */
export function inventoryProtocolHref(
  projectId: string | null,
  label: string | null,
): string {
  const base = resolve("/projects/[id]/inventory/[...label]", {
    id: projectId ?? "",
    label: "",
  });
  return `${base}${protocolInventoryQuery(label)}`;
}
