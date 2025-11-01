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

function match_connections_protocols(
  connections: syntax.Connection[],
  protocols: syntax.Protocol[],
): semantics.Connection[] {
  const protocol_by_name: Record<string, syntax.Protocol> = {};
  for (const protocol of protocols) {
    protocol_by_name[protocol.name] = protocol;
  }

  return connections.map((connection) => {
    const protocol_name = connection.protocol;

    if (!protocol_name) {
      return { ...connection, protocol: undefined };
    }

    const protocol_ref = protocol_by_name[protocol_name];

    if (!protocol_ref) {
      throw new ModelCompilationError(`No protocol named ${protocol_name}`);
    }
    const transformed_connection: semantics.Connection = {
      ...connection,
      protocol: protocol_ref,
    };
    return transformed_connection;
  });
}

export function compile(model: syntax.SystemModel): semantics.SystemModel {
  const components_index: Record<string, semantics.Component> = {};

  // Index all components recursively
  indexComponents(model.components, components_index);

  const connections = match_connections_protocols(
    model.connections,
    model.protocols,
  );

  return {
    name: model.name,
    components_index,
    protocols: model.protocols,
    components: model.components,
    connections: connections,
  };
}
