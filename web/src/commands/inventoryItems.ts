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
import { resolveIcon } from "../iconHelper";

export const INVENTORY_GROUP = "Inventory";

export interface InventoryEntity {
  label: string;
  fullName: string;
  tags: string[];
  /**
   * The definition's own icon name off the model, `""` when it has none.
   * The name and not drawn geometry: resolving it is the row builder's job,
   * and keeping the extraction faithful to the model is what lets it be
   * tested without an icon set in scope.
   */
  icon: string;
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
      icon: component.icon ?? "",
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
    // "Go to component <name>", matching how the command rows read ("Go to
    // Overview"). The section heading already says which list this is; the
    // row says what choosing it does, and a row that is only a bare noun
    // gives the reader nothing to do with it.
    //
    // The drawn label is *not* the addressable name — Inventory's route
    // matches the bare label, so `action` still hands that back and the id
    // stays it too. Searching is unaffected: the name is still inside the
    // label, just further along it.
    label: `Go to component ${entity.label}`,
    // The full name reads as the row's subtitle; an empty one is left out
    // rather than drawn blank. Spread rather than assigned, because
    // `exactOptionalPropertyTypes` distinguishes "absent" from "undefined".
    ...(entity.fullName === "" ? {} : { detail: entity.fullName }),
    // The definition's own icon, in the slot the page commands put their
    // glyph — so a row reads as the same kind of row whichever list it came
    // from, and the list can be scanned by shape as well as by name.
    //
    // `null` rather than absent when there is nothing to draw, because
    // these rows share one list: an absent slot would start half a word
    // earlier than its neighbours and read as a mistake rather than as a
    // definition with no icon. Nothing is drawn in its place either — a
    // generic glyph would be drawing a component row as something it is
    // not — and an icon name that resolves to nothing (`icon` is a
    // free-form string, so a typo or another icon set's name is a value the
    // model legitimately holds) lands here too rather than becoming an
    // empty <svg>.
    icon: resolveIcon(entity.icon),
    // Searchable without being drawn: "stores" and "power" both find the
    // battery, which neither the label nor the subtitle guarantees. The
    // icon's *name* stays out of it — nobody types "battery-three-quarters"
    // looking for the battery.
    hint: [entity.fullName, ...entity.tags].filter((t) => t !== "").join(" "),
    group: INVENTORY_GROUP,
    action: () => {
      onOpen(entity.label);
    },
  }));
}
