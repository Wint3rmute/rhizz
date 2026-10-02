// The palette's Inventory section: the project's own definitions, addressed
// by the label Inventory's route takes.
//
// Only the definitions, and that is a measured constraint rather than a
// preference. Inventory matches `/inventory/<label>` against its `definitions`
// list and falls back to the first row for anything it does not recognise —
// so a row for a system or a protocol would navigate and then silently open
// a *different* entity. Systems and protocols are real in the model (the
// drone example has 2 and 7 respectively) but are not addressable until
// Inventory learns them, so they are deliberately absent here.
import type { PaletteItem } from "../components/palette/commandPalette";
import type { RawModelPayload } from "../modelView";

export const INVENTORY_GROUP = "Inventory";

export interface InventoryEntity {
  label: string;
  fullName: string;
  tags: string[];
}

/** The model's top-level definitions, in model order. */
export function inventoryEntities(
  raw: RawModelPayload | undefined,
): InventoryEntity[] {
  const components = raw?.components ?? [];
  const entities: InventoryEntity[] = [];
  for (const index of raw?.definitions ?? []) {
    const component = components[index];
    if (component === undefined) continue;
    entities.push({
      label: component.label,
      fullName: component.full_name ?? "",
      // Copied, so a row can never write back into the compiled model.
      tags: [...(component.tags ?? [])],
    });
  }
  return entities;
}

export function inventoryItems(
  entities: readonly InventoryEntity[],
  onOpen: (label: string) => void,
): PaletteItem[] {
  return entities.map<PaletteItem>((entity) => ({
    id: `inventory:${entity.label}`,
    label: entity.label,
    // The full name reads as the row's subtitle; an empty one is left out
    // rather than drawn blank. Spread rather than assigned, because
    // `exactOptionalPropertyTypes` distinguishes "absent" from "undefined".
    ...(entity.fullName === "" ? {} : { detail: entity.fullName }),
    // Searchable without being drawn: "stores" and "power" both find the
    // battery, which neither the label nor the subtitle guarantees.
    hint: [entity.fullName, ...entity.tags].filter((t) => t !== "").join(" "),
    group: INVENTORY_GROUP,
    action: () => {
      onOpen(entity.label);
    },
  }));
}
