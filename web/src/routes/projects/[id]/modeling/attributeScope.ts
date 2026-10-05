// Which file each attribute of a node on the Modeling canvas is persisted in.
//
// The inspector shows a node's attributes in one flat list, which reads as
// "editing any of these rewrites the project". It does not: a view-local
// attribute (`text_align`, and the geometry the canvas owns) is written to
// `views/<view>.hcl`, while a component attribute is written to the system
// model. Nothing about the two rows looks different — they are the same kind
// of `form-control` with the same kind of label — so the split is invisible
// until you notice that reopening the same view in another tab shows your
// color change and not your alignment change.
//
// One map, two derived lists, so the inspector's two panels cannot disagree
// with each other or with the write paths (`applyModelMutation` for
// component attributes, the debounced layout save for view ones).

/** Where an attribute is persisted. */
export type AttributeScope = "view" | "component";

/** Every attribute the inspector can edit, and the file it lands in. */
export const ATTRIBUTE_SCOPES = {
  // Component attributes — `system.hcl`, via `update_component`.
  label: "component",
  full_name: "component",
  source: "component",
  icon: "component",
  color: "component",
  border: "component",
  font: "component",
  tags: "component",
  leaf: "component",
  ports: "component",
  // View attributes — the open `views/<view>.hcl`, via the layout save. The
  // geometry keys are listed even though the inspector does not render them:
  // the canvas drags and resizes, and they are the reason the distinction
  // exists at all.
  x: "view",
  y: "view",
  width: "view",
  height: "view",
  text_align: "view",
} as const satisfies Record<string, AttributeScope>;

export type AttributeName = keyof typeof ATTRIBUTE_SCOPES;

/**
 * The file an attribute's edit is persisted in, as the user would name it.
 * `<view>` is a placeholder: the inspector does not know which view is open.
 */
export function scopeFile(scope: AttributeScope): string {
  return scope === "view" ? "views/<view>.hcl" : "system.hcl";
}

/** The component-side attribute names, in declaration order. */
export function componentAttributes(): AttributeName[] {
  return namesWithScope("component");
}

/** The view-side attribute names, in declaration order. */
export function viewAttributes(): AttributeName[] {
  return namesWithScope("view");
}

function namesWithScope(scope: AttributeScope): AttributeName[] {
  return (Object.keys(ATTRIBUTE_SCOPES) as AttributeName[]).filter(
    (name) => ATTRIBUTE_SCOPES[name] === scope,
  );
}
