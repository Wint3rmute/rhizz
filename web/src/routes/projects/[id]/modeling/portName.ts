// Validation for a port's new name, shared by the Node Inspector's port name
// field. Kept free of WASM imports so the inspector's stories load it as is.

/** Why `name` cannot be the new name of the port at `index` among `labels`
 * (the component's port labels), or `undefined` when it can. Mirrors the
 * core op's refusals, so the inspector says it before the model does. */
export function portNameProblem(
  name: string,
  labels: readonly string[],
  index: number,
): string | undefined {
  const trimmed = name.trim();
  if (trimmed === "") return "A port name cannot be empty.";
  if (trimmed.includes("/")) return "A port name cannot contain “/”.";
  if (labels.some((label, i) => i !== index && label === trimmed)) {
    return `A port named “${trimmed}” already exists.`;
  }
  return undefined;
}
