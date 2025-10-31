import * as syntax from "./model-syntax.ts";
import * as semantics from "./model-semantics.ts";

export class ModelCompilationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelCompilationError";
  }
}

function indexComponents(
  components: syntax.Component[],
  index: Record<string, semantics.Component>,
): void {
  for (const component of components) {
    // Add the current component to the index
    if (index[component.name]) {
      throw new ModelCompilationError(
        `Component '${component.name}' is already defined`,
      );
    }
    index[component.name] = component;

    // Recursively index nested components if they exist
    if (component.components && component.components.length > 0) {
      indexComponents(component.components, index);
    }
  }
}

export function compile(model: syntax.SystemModel): semantics.SystemModel {
  const components_index: Record<string, semantics.Component> = {};

  // Index all components recursively
  indexComponents(model.components, components_index);

  return {
    name: model.name,
    components_index,
    protocols: model.protocols,
    components: model.components,
    connections: model.connections,
  };
}
